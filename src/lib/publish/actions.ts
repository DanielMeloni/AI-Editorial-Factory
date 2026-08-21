'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { recordAudit } from '@/lib/security/audit';
import { checkRateLimit } from '@/lib/security/rate-limit';
import type { Citation, ExportMeta } from './markdown';
import { exportHtml } from './html';
import { exportPdf } from './pdf';
import { exportEpub } from './epub';
import { deriveArticle, deriveLesson } from './derivations';
import { rebuildVolumePreviewWith, type EsitoAnteprima } from './preview';
import { scegliVersioneCompleta, type VersioneComponibile } from './volume';

/**
 * Produzione degli output editoriali.
 *
 * Si esporta soltanto da una versione **approvata**: il senso del gate umano
 * della Fase 4 verrebbe meno se si potesse pubblicare una proposta non
 * approvata.
 *
 * I file finiscono in un bucket privato e si scaricano tramite URL firmati a
 * breve scadenza.
 */

export interface PublishResult {
  ok: boolean;
  message: string;
  exportId?: string;
}

const FORMATI = ['pdf', 'epub', 'html'] as const;
export type ExportFormat = (typeof FORMATI)[number];

const requestSchema = z.object({
  chapterId: z.string().uuid(),
  formats: z.array(z.enum(FORMATI)).min(1, 'Scegli almeno un formato'),
  includeDerivations: z.boolean().default(true),
});

const CONTENT_TYPE: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  html: 'text/html; charset=utf-8',
};

const ESTENSIONE: Record<ExportFormat, string> = {
  pdf: 'pdf',
  epub: 'epub',
  html: 'html',
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function publishChapter(input: {
  chapterId: string;
  formats: ExportFormat[];
  includeDerivations?: boolean;
}): Promise<PublishResult> {
  const user = await requireUser();
  const organization = await requireOrganization();

  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };

  const supabase = await createClient();

  // ---------------------------------------------------------------------
  // Capitolo, progetto e versione corrente
  // ---------------------------------------------------------------------
  const { data: chapter } = await supabase
    .from('chapters')
    .select('id, project_id, organization_id, number, label, title, status, current_version_id')
    .eq('id', parsed.data.chapterId)
    .maybeSingle<{
      id: string;
      project_id: string;
      organization_id: string;
      number: number | null;
      label: string | null;
      title: string;
      status: string;
      current_version_id: string | null;
    }>();

  if (!chapter || chapter.organization_id !== organization.id) {
    return { ok: false, message: 'Capitolo non trovato.' };
  }
  if (!chapter.current_version_id) {
    return { ok: false, message: 'Il capitolo non ha una versione corrente da esportare.' };
  }

  const { data: versions, error: versionsError } = await supabase
    .from('chapter_versions')
    .select(
      'id, chapter_id, version_no, content_md, origin, is_approved, word_count, parent_version_id',
    )
    .eq('chapter_id', chapter.id)
    .returns<(VersioneComponibile & { origin: string; is_approved: boolean })[]>();

  if (versionsError) {
    return { ok: false, message: `Lettura delle versioni fallita: ${versionsError.message}` };
  }
  const version = scegliVersioneCompleta(chapter.id, chapter.current_version_id, versions ?? []);
  if (!version) return { ok: false, message: 'Nessuna versione completa del capitolo reperibile.' };

  // Il gate umano della Fase 4 sarebbe inutile se si potesse esportare una
  // proposta non approvata.
  const versioneConStato = (versions ?? []).find((candidate) => candidate.id === version.id);
  if (
    chapter.status !== 'approved' &&
    chapter.status !== 'published' &&
    versioneConStato?.origin === 'ai_proposal' &&
    !versioneConStato.is_approved
  ) {
    return {
      ok: false,
      message:
        'La versione corrente è una proposta non ancora approvata. Approvala dalla scheda Revisioni prima di esportare.',
    };
  }

  const limite = await checkRateLimit(supabase, 'exportRun', organization.id);
  if (!limite.allowed) return { ok: false, message: limite.message };

  const { data: project } = await supabase
    .from('projects')
    .select('title, author, volume')
    .eq('id', chapter.project_id)
    .maybeSingle<{ title: string; author: string; volume: string | null }>();

  const { data: citazioni } = await supabase
    .from('citations')
    .select('url, title, publisher, is_official')
    .eq('chapter_id', chapter.id)
    .returns<
      { url: string; title: string | null; publisher: string | null; is_official: boolean }[]
    >();

  const citations: Citation[] = (citazioni ?? []).map((c) => ({
    url: c.url,
    title: c.title,
    publisher: c.publisher,
    isOfficial: c.is_official,
  }));

  const meta: ExportMeta = {
    title: chapter.title,
    chapterNumber: chapter.number,
    chapterLabel: chapter.label
      ? chapter.number === null
        ? `Appendice ${chapter.label}`
        : `Capitolo ${chapter.label}`
      : null,
    author: project?.author ?? '',
    projectTitle: project?.title ?? '',
    volume: project?.volume ?? null,
    versionNo: version.version_no,
    exportedAt: new Date().toISOString(),
  };
  const contenutoCompleto = sanitizzaContenutoExport(version.content_md);

  // ---------------------------------------------------------------------
  // Derivazioni
  // ---------------------------------------------------------------------
  const outputIds: string[] = [];

  if (parsed.data.includeDerivations) {
    const lezione = deriveLesson(contenutoCompleto, {
      title: chapter.title,
      chapterLabel: meta.chapterLabel,
    });
    const articolo = deriveArticle(contenutoCompleto, {
      title: chapter.title,
      author: meta.author,
      projectTitle: meta.projectTitle,
    });

    for (const [kind, titolo, contenuto, extra] of [
      ['lesson', lezione.title, lezione, { pending: lezione.pendingAuthoring }],
      ['article', articolo.title, articolo, { slug: articolo.slug, seo: articolo.seo }],
    ] as const) {
      const { data } = await supabase
        .from('publication_outputs')
        .insert({
          project_id: chapter.project_id,
          organization_id: organization.id,
          chapter_id: chapter.id,
          chapter_version_id: version.id,
          kind,
          title: titolo,
          slug: kind === 'article' ? articolo.slug : null,
          meta: extra,
          content: contenuto,
          created_by: user.id,
        })
        .select('id')
        .single<{ id: string }>();

      if (data) outputIds.push(data.id);
    }
  }

  // ---------------------------------------------------------------------
  // File
  // ---------------------------------------------------------------------
  const base = `${organization.id}/${chapter.project_id}/exports/${chapter.id}/v${version.version_no}`;
  const nomeFile = `${(chapter.label ?? String(chapter.number ?? 'capitolo')).replace(/[^\w-]/g, '')}-${
    meta.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50) || 'capitolo'
  }`;

  const errori: string[] = [];
  let ultimoExportId: string | undefined;

  for (const formato of parsed.data.formats) {
    const { data: exportRow, error: exportInsertError } = await supabase
      .from('exports')
      .insert({
        project_id: chapter.project_id,
        organization_id: organization.id,
        chapter_id: chapter.id,
        publication_output_id: null,
        format: formato,
        status: 'running',
        storage_bucket: 'publication-exports',
        requested_by: user.id,
      })
      .select('id')
      .single<{ id: string }>();

    if (!exportRow) {
      errori.push(`${formato}: ${exportInsertError?.message ?? 'registrazione non riuscita'}`);
      continue;
    }

    try {
      let bytes: Uint8Array;

      switch (formato) {
        case 'html': {
          const esito = await exportHtml(contenutoCompleto, meta, { citations });
          bytes = new TextEncoder().encode(esito.html);
          break;
        }
        case 'pdf':
          bytes = await exportPdf(contenutoCompleto, meta, { citations });
          break;
        case 'epub':
          bytes = await exportEpub(contenutoCompleto, meta, { citations });
          break;
      }

      const percorso = `${base}/${nomeFile}.${ESTENSIONE[formato]}`;

      const { error: uploadError } = await supabase.storage
        .from('publication-exports')
        .upload(percorso, bytes, { contentType: CONTENT_TYPE[formato], upsert: true });

      if (uploadError) throw new Error(uploadError.message);

      await supabase
        .from('exports')
        .update({
          status: 'ready',
          storage_path: percorso,
          byte_size: bytes.byteLength,
          checksum: await sha256Hex(bytes),
          completed_at: new Date().toISOString(),
        })
        .eq('id', exportRow.id);

      ultimoExportId = exportRow.id;
    } catch (error) {
      const messaggio = error instanceof Error ? error.message : String(error);
      // Un formato fallito non compromette gli altri.
      console.error(`Esportazione ${formato} fallita`, messaggio);
      await supabase
        .from('exports')
        .update({ status: 'failed', error: messaggio, completed_at: new Date().toISOString() })
        .eq('id', exportRow.id);
      errori.push(`${formato}: non riuscito`);
    }
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'chapter.published',
    entityType: 'chapter',
    entityId: chapter.id,
    metadata: {
      formats: parsed.data.formats,
      versionNo: version.version_no,
      outputs: outputIds.length,
    },
  });

  revalidatePath(`/projects/${chapter.project_id}/exports`);

  const riusciti = parsed.data.formats.length - errori.length;

  return {
    ok: riusciti > 0,
    exportId: ultimoExportId,
    message:
      errori.length === 0
        ? `${riusciti} formati esportati dalla versione ${version.version_no}.`
        : `${riusciti} formati esportati. Non riusciti: ${errori.join(', ')}.`,
  };
}

function sanitizzaContenutoExport(markdown: string): string {
  return markdown.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/** URL di download a breve scadenza. I bucket restano privati. */
export async function getExportDownloadUrl(exportId: string): Promise<string | null> {
  await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data } = await supabase
    .from('exports')
    .select('storage_bucket, storage_path, organization_id, status')
    .eq('id', exportId)
    .maybeSingle<{
      storage_bucket: string;
      storage_path: string | null;
      organization_id: string;
      status: string;
    }>();

  if (!data?.storage_path || data.organization_id !== organization.id || data.status !== 'ready') {
    return null;
  }

  const { data: firmato } = await supabase.storage
    .from(data.storage_bucket)
    .createSignedUrl(data.storage_path, 120, { download: true });

  return firmato?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------
// Anteprima del volume
// ---------------------------------------------------------------------------

/**
 * Ricostruisce l'anteprima su richiesta.
 *
 * Il workflow la aggiorna da solo a ogni capitolo convalidato; questo pulsante
 * serve quando si è cambiato qualcosa fuori dal workflow — una modifica manuale,
 * la bibliografia rigenerata — e si vuole rivedere il volume senza avviare un
 * audit.
 */
export async function rebuildVolumePreview(projectId: string): Promise<EsitoAnteprima> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const esito = await rebuildVolumePreviewWith(supabase, {
    projectId,
    organizationId: organization.id,
    actorId: user.id,
  });

  if (esito.ok) revalidatePath(`/projects/${projectId}/preview`);
  return esito;
}

/** URL firmato dell'anteprima corrente, se esiste. */
export async function getVolumePreviewUrl(projectId: string): Promise<string | null> {
  await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const path = `${organization.id}/${projectId}/volume/anteprima.pdf`;
  const { data } = await supabase.storage.from('publication-exports').createSignedUrl(path, 3600);

  return data?.signedUrl ?? null;
}
