'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { recordAudit } from '@/lib/security/audit';
import { decideReview } from '@/lib/workflows/actions';
import { applySelectedHunks } from '@/lib/review/diff';

/**
 * Azioni della revisione umana.
 *
 * Nessuna di queste sovrascrive il testo originale: quando il revisore accetta
 * una selezione di modifiche o interviene a mano, viene creata una **nuova**
 * versione con `origin = 'human_edit'`, che diventa la proposta da approvare.
 * L'originale resta la versione 1, protetta da trigger.
 */

export interface ReviewActionResult {
  ok: boolean;
  message: string;
}

const commentSchema = z.object({
  body: z.string().trim().min(1, 'Il commento è vuoto').max(10_000),
  hunkId: z.number().int().nonnegative().nullable(),
});

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verifica che la revisione appartenga all'organizzazione dell'utente. */
async function loadAuthorizedReview(reviewId: string) {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data } = await supabase
    .from('review_requests')
    .select('id, status, project_id, chapter_id, organization_id, base_version_id, proposed_version_id')
    .eq('id', reviewId)
    .maybeSingle<{
      id: string; status: string; project_id: string; chapter_id: string;
      organization_id: string; base_version_id: string | null; proposed_version_id: string | null;
    }>();

  if (!data || data.organization_id !== organization.id) return null;
  return { review: data, user, organization, supabase };
}

/**
 * Crea una nuova versione a partire da un contenuto e la designa come proposta
 * corrente della revisione.
 */
async function createHumanVersion(
  ctx: NonNullable<Awaited<ReturnType<typeof loadAuthorizedReview>>>,
  contentMd: string,
  summary: string,
): Promise<string | null> {
  const { supabase, review, user, organization } = ctx;

  const { data: last } = await supabase
    .from('chapter_versions')
    .select('version_no')
    .eq('chapter_id', review.chapter_id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle<{ version_no: number }>();

  const { data: created, error } = await supabase
    .from('chapter_versions')
    .insert({
      chapter_id: review.chapter_id,
      project_id: review.project_id,
      organization_id: organization.id,
      version_no: (last?.version_no ?? 0) + 1,
      origin: 'human_edit',
      content_md: contentMd,
      content_hash: await sha256Hex(contentMd),
      summary,
      word_count: contentMd.split(/\s+/).filter(Boolean).length,
      parent_version_id: review.proposed_version_id,
      created_by: user.id,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !created) return null;

  // La versione appena creata diventa quella su cui si deciderà.
  await supabase
    .from('review_requests')
    .update({ proposed_version_id: created.id })
    .eq('id', review.id);

  return created.id;
}

// ---------------------------------------------------------------------------
// Approvazione integrale
// ---------------------------------------------------------------------------

export async function approveAll(reviewId: string, note: string | null): Promise<ReviewActionResult> {
  const ctx = await loadAuthorizedReview(reviewId);
  if (!ctx) return { ok: false, message: 'Revisione non trovata.' };
  if (ctx.review.status !== 'pending') return { ok: false, message: 'La revisione è già stata decisa.' };

  return decideReview(reviewId, 'approved', note);
}

// ---------------------------------------------------------------------------
// Approvazione di una selezione di modifiche
// ---------------------------------------------------------------------------

export async function approveSelection(
  reviewId: string,
  selectedHunkIds: number[],
  note: string | null,
): Promise<ReviewActionResult> {
  const ctx = await loadAuthorizedReview(reviewId);
  if (!ctx) return { ok: false, message: 'Revisione non trovata.' };
  if (ctx.review.status !== 'pending') return { ok: false, message: 'La revisione è già stata decisa.' };

  const { supabase, review } = ctx;

  if (!review.base_version_id || !review.proposed_version_id) {
    return { ok: false, message: 'Versioni di confronto non disponibili.' };
  }

  const { data: versions } = await supabase
    .from('chapter_versions')
    .select('id, content_md')
    .in('id', [review.base_version_id, review.proposed_version_id])
    .returns<{ id: string; content_md: string }[]>();

  const base = versions?.find((v) => v.id === review.base_version_id)?.content_md;
  const proposed = versions?.find((v) => v.id === review.proposed_version_id)?.content_md;

  if (base === undefined || proposed === undefined) {
    return { ok: false, message: 'Contenuto delle versioni non reperibile.' };
  }

  if (selectedHunkIds.length === 0) {
    return {
      ok: false,
      message: 'Nessuna modifica selezionata: per non accettare nulla, usa «Rifiuta».',
    };
  }

  const merged = applySelectedHunks(base, proposed, selectedHunkIds);

  // Se la selezione coincide con l'intera proposta, non serve una versione nuova.
  if (merged === proposed) return decideReview(reviewId, 'approved', note);

  const versionId = await createHumanVersion(
    ctx,
    merged,
    `Approvazione parziale: ${selectedHunkIds.length} modifiche accettate su ${
      selectedHunkIds.length
    } selezionate.`,
  );

  if (!versionId) return { ok: false, message: 'Creazione della versione non riuscita.' };

  await recordAudit({
    organizationId: ctx.organization.id,
    actorId: ctx.user.id,
    action: 'review.partial_approval',
    entityType: 'review_request',
    entityId: reviewId,
    metadata: { selectedHunks: selectedHunkIds.length, versionId },
  });

  return decideReview(reviewId, 'approved', note);
}

// ---------------------------------------------------------------------------
// Modifica manuale
// ---------------------------------------------------------------------------

export async function saveManualEdit(
  reviewId: string,
  contentMd: string,
): Promise<ReviewActionResult> {
  const ctx = await loadAuthorizedReview(reviewId);
  if (!ctx) return { ok: false, message: 'Revisione non trovata.' };
  if (ctx.review.status !== 'pending') return { ok: false, message: 'La revisione è già stata decisa.' };

  const parsed = z.string().trim().min(1, 'Il contenuto è vuoto').safeParse(contentMd);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };

  const versionId = await createHumanVersion(ctx, contentMd, 'Modifica manuale del revisore.');
  if (!versionId) return { ok: false, message: 'Salvataggio non riuscito.' };

  await recordAudit({
    organizationId: ctx.organization.id,
    actorId: ctx.user.id,
    action: 'review.manual_edit',
    entityType: 'chapter_version',
    entityId: versionId,
  });

  revalidatePath(`/projects/${ctx.review.project_id}/reviews/${reviewId}`);
  return { ok: true, message: 'Modifica salvata come nuova versione. Ora puoi approvarla.' };
}

// ---------------------------------------------------------------------------
// Rifiuto e richiesta di modifica
// ---------------------------------------------------------------------------

export async function rejectReview(reviewId: string, note: string | null): Promise<ReviewActionResult> {
  const ctx = await loadAuthorizedReview(reviewId);
  if (!ctx) return { ok: false, message: 'Revisione non trovata.' };
  if (ctx.review.status !== 'pending') return { ok: false, message: 'La revisione è già stata decisa.' };

  return decideReview(reviewId, 'rejected', note);
}

export async function requestChanges(reviewId: string, note: string | null): Promise<ReviewActionResult> {
  const ctx = await loadAuthorizedReview(reviewId);
  if (!ctx) return { ok: false, message: 'Revisione non trovata.' };
  if (ctx.review.status !== 'pending') return { ok: false, message: 'La revisione è già stata decisa.' };

  if (!note || note.trim().length === 0) {
    return { ok: false, message: 'Indica che cosa va cambiato: la richiesta senza motivazione non è utile.' };
  }

  return decideReview(reviewId, 'changes_requested', note);
}

// ---------------------------------------------------------------------------
// Commenti
// ---------------------------------------------------------------------------

export async function addComment(
  reviewId: string,
  body: string,
  hunkId: number | null,
): Promise<ReviewActionResult> {
  const ctx = await loadAuthorizedReview(reviewId);
  if (!ctx) return { ok: false, message: 'Revisione non trovata.' };

  const parsed = commentSchema.safeParse({ body, hunkId });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };

  const { error } = await ctx.supabase.from('review_comments').insert({
    review_request_id: reviewId,
    project_id: ctx.review.project_id,
    organization_id: ctx.organization.id,
    author_id: ctx.user.id,
    body: parsed.data.body,
    anchor: parsed.data.hunkId === null ? {} : { hunkId: parsed.data.hunkId },
  });

  if (error) return { ok: false, message: 'Commento non salvato.' };

  revalidatePath(`/projects/${ctx.review.project_id}/reviews/${reviewId}`);
  return { ok: true, message: 'Commento aggiunto.' };
}

export async function toggleCommentResolved(
  reviewId: string,
  commentId: string,
  resolved: boolean,
): Promise<ReviewActionResult> {
  const ctx = await loadAuthorizedReview(reviewId);
  if (!ctx) return { ok: false, message: 'Revisione non trovata.' };

  await ctx.supabase
    .from('review_comments')
    .update({ is_resolved: resolved })
    .eq('id', commentId)
    .eq('review_request_id', reviewId);

  revalidatePath(`/projects/${ctx.review.project_id}/reviews/${reviewId}`);
  return { ok: true, message: resolved ? 'Commento risolto.' : 'Commento riaperto.' };
}

// ---------------------------------------------------------------------------
// Ripristino di una versione precedente
// ---------------------------------------------------------------------------

export async function restoreVersion(
  chapterId: string,
  versionId: string,
): Promise<ReviewActionResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: version } = await supabase
    .from('chapter_versions')
    .select('id, chapter_id, version_no, organization_id, project_id')
    .eq('id', versionId)
    .maybeSingle<{
      id: string; chapter_id: string; version_no: number; organization_id: string; project_id: string;
    }>();

  if (!version || version.chapter_id !== chapterId || version.organization_id !== organization.id) {
    return { ok: false, message: 'Versione non trovata.' };
  }

  // Il ripristino non cancella nulla: sposta soltanto il puntatore alla
  // versione corrente. Tutte le versioni restano consultabili.
  await supabase
    .from('chapters')
    .update({ current_version_id: versionId })
    .eq('id', chapterId);

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'chapter.version_restored',
    entityType: 'chapter',
    entityId: chapterId,
    metadata: { versionId, versionNo: version.version_no },
  });

  revalidatePath(`/projects/${version.project_id}/chapters/${chapterId}`);
  return { ok: true, message: `Ripristinata la versione ${version.version_no}.` };
}
