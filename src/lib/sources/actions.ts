'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { recordAudit } from '@/lib/security/audit';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { analyzeMarkdown } from '@/lib/ingest/markdown';
import { extractClaims } from '@/lib/agents/analysis/claims';
import { buildProjectIndex } from './library';
import { discoverSources } from './discovery';
import { researchClaims } from './research';
import { extractLink } from './extract';
import {
  addLinkSchema,
  addPdfSchema,
  buildReferenceStoragePath,
  type ReferenceChunk,
} from './references';

/**
 * Comandi sulla biblioteca e sulla ricerca delle fonti.
 *
 * L'autorizzazione avviene qui, con la sessione dell'utente e la RLS attiva.
 * Nessuna azione si fida dell'identificativo di progetto ricevuto dal browser:
 * l'appartenenza all'organizzazione viene sempre riverificata.
 */

export interface CommandResult {
  ok: boolean;
  message: string;
}

const BUCKET = 'project-sources';

/** Verifica che il progetto esista e appartenga all'organizzazione dell'utente. */
async function requireProject(projectId: string) {
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id')
    .eq('id', projectId)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (!project || project.organization_id !== organization.id) return null;
  return { supabase, organization, project };
}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

/**
 * Registra un indirizzo e ne indicizza il testo.
 *
 * Se la pagina non risponde, il collegamento viene comunque registrato: resta
 * citabile a mano, e lo stato dice a chiare lettere che non è indicizzato. Una
 * fonte irraggiungibile oggi può tornare raggiungibile domani, e cancellarla
 * sarebbe una decisione presa al posto dell'autore.
 */
export async function addLinkReference(input: unknown): Promise<CommandResult> {
  const user = await requireUser();

  const parsed = addLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dati non validi.' };
  }

  const context = await requireProject(parsed.data.projectId);
  if (!context) return { ok: false, message: 'Progetto non trovato.' };
  const { supabase, organization, project } = context;

  const referenceId = randomUUID();
  const scoped = parsed.data.scope === 'project' ? project.id : null;

  const { error: insertError } = await supabase.from('reference_sources').insert({
    id: referenceId,
    organization_id: organization.id,
    project_id: scoped,
    kind: 'link',
    scope: parsed.data.scope,
    title: parsed.data.title,
    url: parsed.data.url,
    note: parsed.data.note || null,
    is_authoritative: parsed.data.isAuthoritative,
    status: 'indexing',
    created_by: user.id,
  });

  if (insertError) {
    return { ok: false, message: `Registrazione non riuscita: ${insertError.message}` };
  }

  const extraction = await extractLink(parsed.data.url);
  const esito = await saveChunks(supabase, {
    referenceId,
    organizationId: organization.id,
    projectId: scoped,
    chunks: extraction.chunks,
    pageCount: extraction.pageCount,
    warnings: extraction.warnings,
  });

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'reference.added',
    entityType: 'reference_source',
    entityId: referenceId,
    metadata: { kind: 'link', url: parsed.data.url, chunks: extraction.chunks.length },
  });

  revalidatePath(`/projects/${project.id}/sources`);

  return {
    ok: true,
    message:
      extraction.chunks.length > 0
        ? `Collegamento aggiunto e indicizzato: ${extraction.chunks.length} blocchi di testo.`
        : `Collegamento aggiunto ma non indicizzato. ${esito}`,
  };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export interface PdfTicket {
  ok: true;
  referenceId: string;
  bucket: string;
  path: string;
  token: string;
}

/**
 * Emette un URL firmato per caricare un PDF direttamente su Supabase Storage.
 * Il file non passa mai dal server applicativo: una Vercel Function accetta al
 * massimo circa 4,5 MB di corpo.
 */
export async function requestPdfTicket(
  input: unknown,
): Promise<PdfTicket | { ok: false; message: string }> {
  const user = await requireUser();

  const parsed = addPdfSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dati non validi.' };
  }

  const context = await requireProject(parsed.data.projectId);
  if (!context) return { ok: false, message: 'Progetto non trovato.' };
  const { supabase, organization, project } = context;

  const referenceId = randomUUID();
  const path = buildReferenceStoragePath(
    organization.id,
    project.id,
    referenceId,
    parsed.data.filename,
  );

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (signError || !signed) {
    return { ok: false, message: 'Impossibile preparare il caricamento. Riprova.' };
  }

  const { error: insertError } = await supabase.from('reference_sources').insert({
    id: referenceId,
    organization_id: organization.id,
    project_id: parsed.data.scope === 'project' ? project.id : null,
    kind: 'pdf',
    scope: parsed.data.scope,
    title: parsed.data.title,
    storage_path: path,
    original_filename: parsed.data.filename,
    byte_size: parsed.data.byteSize,
    note: parsed.data.note || null,
    is_authoritative: parsed.data.isAuthoritative,
    status: 'pending',
    created_by: user.id,
  });

  if (insertError) {
    return { ok: false, message: `Registrazione non riuscita: ${insertError.message}` };
  }

  return { ok: true, referenceId, bucket: BUCKET, path, token: signed.token };
}

// ---------------------------------------------------------------------------
// Rimozione
// ---------------------------------------------------------------------------

export async function removeReference(referenceId: string): Promise<CommandResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: reference } = await supabase
    .from('reference_sources')
    .select('id, organization_id, project_id, storage_path, title')
    .eq('id', referenceId)
    .maybeSingle<{
      id: string;
      organization_id: string;
      project_id: string | null;
      storage_path: string | null;
      title: string;
    }>();

  if (!reference || reference.organization_id !== organization.id) {
    return { ok: false, message: 'Fonte non trovata.' };
  }

  if (reference.storage_path) {
    // Il file viene rimosso prima della riga: un oggetto orfano nello storage
    // non lo vedrebbe più nessuno.
    await supabase.storage.from(BUCKET).remove([reference.storage_path]);
  }

  const { error } = await supabase.from('reference_sources').delete().eq('id', referenceId);
  if (error) return { ok: false, message: `Rimozione non riuscita: ${error.message}` };

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'reference.removed',
    entityType: 'reference_source',
    entityId: referenceId,
    metadata: { title: reference.title },
  });

  if (reference.project_id) revalidatePath(`/projects/${reference.project_id}/sources`);
  return { ok: true, message: 'Fonte rimossa.' };
}

// ---------------------------------------------------------------------------
// Ricerca su richiesta
// ---------------------------------------------------------------------------

export interface SearchOutcome extends CommandResult {
  found?: number;
  unmatched?: number;
  chapters?: number;
}

/**
 * «Cerca fonti»: interroga documentazione ufficiale e biblioteca per tutte le
 * affermazioni prive di rimando del progetto.
 *
 * È la stessa ricerca che gira dentro l'audit, richiamabile da sola. Serve
 * quando la biblioteca cambia: si carica una specifica e si vuole sapere subito
 * che cosa sostiene, senza rieseguire un audit intero.
 *
 * Le proposte già decise non vengono toccate: rifare la ricerca non cancella il
 * lavoro di chi ha già scelto.
 */
export async function searchProjectSources(projectId: string): Promise<SearchOutcome> {
  const user = await requireUser();

  const context = await requireProject(projectId);
  if (!context) return { ok: false, message: 'Progetto non trovato.' };
  const { supabase, organization, project } = context;

  const { data: chapters } = await supabase
    .from('chapters')
    .select('id, title, number, current_version_id')
    .eq('project_id', project.id)
    .order('order_index', { ascending: true })
    .returns<{ id: string; title: string; number: number | null; current_version_id: string | null }[]>();

  if (!chapters || chapters.length === 0) {
    return { ok: false, message: 'Nessun capitolo da analizzare: carica prima l’archivio.' };
  }

  const { index, libraryEntries } = await buildProjectIndex(supabase, organization.id, project.id);

  let found = 0;
  let unmatched = 0;
  let analizzati = 0;

  for (const chapter of chapters) {
    const { data: version } = await supabase
      .from('chapter_versions')
      .select('content_md')
      .eq('chapter_id', chapter.id)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle<{ content_md: string }>();

    if (!version) continue;
    analizzati += 1;

    const analysis = analyzeMarkdown(version.content_md);
    const claims = extractClaims(
      version.content_md,
      new Set(analysis.links.map((link) => link.line)),
    );

    const research = researchClaims(claims, index);
    unmatched += research.unmatched;

    // Si sostituiscono solo le proposte non ancora decise: quelle accettate o
    // scartate sono decisioni umane, e una nuova ricerca non le annulla.
    await supabase
      .from('source_suggestions')
      .delete()
      .eq('chapter_id', chapter.id)
      .eq('status', 'proposed');

    const rows = research.suggestions.flatMap((suggestion) =>
      suggestion.candidates.map((candidate, position) => ({
        project_id: project.id,
        organization_id: organization.id,
        chapter_id: chapter.id,
        workflow_run_id: null,
        claim_line: suggestion.line,
        claim_excerpt: suggestion.statement,
        category: suggestion.category,
        url: candidate.url,
        title: candidate.title,
        section: candidate.section,
        score: candidate.score,
        rank: position + 1,
        matched_terms: candidate.matchedTerms,
        origin: candidate.origin,
        reference_id: candidate.referenceId,
        page: candidate.page,
        status: 'proposed',
      })),
    );

    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from('source_suggestions').insert(rows.slice(i, i + 100));
      if (error) return { ok: false, message: `Salvataggio delle proposte fallito: ${error.message}` };
    }

    found += research.suggestions.length;
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'sources.searched',
    entityType: 'project',
    entityId: project.id,
    metadata: { found, unmatched, chapters: analizzati, libraryEntries },
  });

  revalidatePath(`/projects/${project.id}/sources`);

  return {
    ok: true,
    found,
    unmatched,
    chapters: analizzati,
    message:
      found === 0
        ? `Nessuna fonte pertinente per le affermazioni scoperte di ${analizzati} capitoli.`
        : `${found} affermazioni con una fonte proposta su ${analizzati} capitoli` +
          (unmatched > 0 ? `; per ${unmatched} l’indice non ha nulla di pertinente.` : '.'),
  };
}

// ---------------------------------------------------------------------------
// Ricerca sul web
// ---------------------------------------------------------------------------

export interface DiscoveryResult extends CommandResult {
  proposed?: number;
  found?: number;
  unreachable?: number;
  warnings?: string[];
}

/**
 * «Cerca fonti sul web»: trova materiale di riferimento per il manuale.
 *
 * Le fonti trovate entrano in biblioteca come **proposte**, non come fonti:
 * non vengono indicizzate e non partecipano alla ricerca finché qualcuno non
 * le accetta. Fra il trovarle e l'usarle c'è una persona, ed è voluto.
 */
export async function discoverWebSources(
  projectId: string,
  extraQuery?: string,
): Promise<DiscoveryResult> {
  const user = await requireUser();

  const context = await requireProject(projectId);
  if (!context) return { ok: false, message: 'Progetto non trovato.' };
  const { supabase, organization, project } = context;

  const { data: dettagli } = await supabase
    .from('projects')
    .select('title, subtitle, language')
    .eq('id', project.id)
    .maybeSingle<{ title: string; subtitle: string | null; language: string }>();

  if (!dettagli) return { ok: false, message: 'Progetto non leggibile.' };

  const limite = await checkRateLimit(supabase, 'workflowStart', organization.id);
  if (!limite.allowed) return { ok: false, message: limite.message };

  // Gli argomenti del volume sono i titoli dei capitoli: descrivono l'opera
  // meglio di qualunque parola chiave scelta a tavolino.
  const { data: chapters } = await supabase
    .from('chapters')
    .select('title')
    .eq('project_id', project.id)
    .order('order_index', { ascending: true })
    .limit(60)
    .returns<{ title: string }[]>();

  try {
    const esito = await discoverSources(
      { db: supabase, organizationId: organization.id, projectId: project.id, actorId: user.id },
      dettagli,
      (chapters ?? []).map((chapter) => chapter.title),
      extraQuery ?? null,
    );

    await recordAudit({
      organizationId: organization.id,
      actorId: user.id,
      action: 'sources.discovered',
      entityType: 'project',
      entityId: project.id,
      metadata: {
        proposed: esito.proposed,
        found: esito.found,
        unreachable: esito.unreachable,
        costUsd: esito.estimatedCostUsd,
      },
    });

    revalidatePath(`/projects/${project.id}/sources`);

    return {
      ok: true,
      proposed: esito.proposed,
      found: esito.found,
      unreachable: esito.unreachable,
      warnings: esito.warnings,
      message:
        esito.proposed > 0
          ? `${esito.proposed} fonti proposte su ${esito.found} indirizzi trovati` +
            (esito.unreachable > 0 ? `, ${esito.unreachable} scartati perché irraggiungibili.` : '.')
          : esito.warnings[0] ??
            'Nessuna fonte proposta: la ricerca non ha prodotto pagine utili e verificabili.',
    };
  } catch (caught) {
    return { ok: false, message: (caught as Error).message || 'Ricerca non riuscita.' };
  }
}

/**
 * Accetta una fonte proposta dalla ricerca e la indicizza.
 * Da quel momento smette di essere un suggerimento e diventa una fonte del
 * progetto, interrogabile come le altre.
 */
export async function acceptProposedReference(referenceId: string): Promise<CommandResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: reference } = await supabase
    .from('reference_sources')
    .select('id, organization_id, project_id, url, status, kind, title')
    .eq('id', referenceId)
    .maybeSingle<{
      id: string;
      organization_id: string;
      project_id: string | null;
      url: string | null;
      status: string;
      kind: string;
      title: string;
    }>();

  if (!reference || reference.organization_id !== organization.id) {
    return { ok: false, message: 'Proposta non trovata.' };
  }
  if (reference.status !== 'proposed') {
    return { ok: false, message: 'Questa fonte è già stata decisa.' };
  }
  if (reference.kind !== 'link' || reference.url === null) {
    return { ok: false, message: 'Proposta non valida: manca l’indirizzo.' };
  }

  await supabase
    .from('reference_sources')
    .update({ status: 'indexing', error_message: null })
    .eq('id', referenceId);

  const extraction = await extractLink(reference.url);
  const nota = await saveChunks(supabase, {
    referenceId,
    organizationId: organization.id,
    projectId: reference.project_id,
    chunks: extraction.chunks,
    pageCount: extraction.pageCount,
    warnings: extraction.warnings,
  });

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'reference.accepted',
    entityType: 'reference_source',
    entityId: referenceId,
    metadata: { title: reference.title, chunks: extraction.chunks.length },
  });

  if (reference.project_id) revalidatePath(`/projects/${reference.project_id}/sources`);

  return {
    ok: true,
    message:
      extraction.chunks.length > 0
        ? `«${reference.title}» aggiunta e indicizzata: ${extraction.chunks.length} blocchi.`
        : `«${reference.title}» aggiunta ma non indicizzata. ${nota}`,
  };
}

// ---------------------------------------------------------------------------
// Decisione su una proposta
// ---------------------------------------------------------------------------

/**
 * Accetta o scarta una fonte proposta.
 *
 * Accettare crea una riga in `citations`: da quel momento la fonte è citata dal
 * capitolo, non più solo suggerita. Il testo del capitolo **non** viene toccato:
 * dove collocare il rimando resta una scelta editoriale.
 */
export async function decideSuggestion(
  suggestionId: string,
  decision: 'accepted' | 'rejected',
): Promise<CommandResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: suggestion } = await supabase
    .from('source_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .maybeSingle<{
      id: string;
      organization_id: string;
      project_id: string;
      chapter_id: string;
      url: string | null;
      title: string;
      section: string | null;
      origin: string;
      reference_id: string | null;
      page: number | null;
      claim_line: number;
    }>();

  if (!suggestion || suggestion.organization_id !== organization.id) {
    return { ok: false, message: 'Proposta non trovata.' };
  }

  const { error } = await supabase
    .from('source_suggestions')
    .update({
      status: decision,
      decided_by: user.id,
      decided_at: new Date().toISOString(),
    })
    .eq('id', suggestionId);

  if (error) return { ok: false, message: `Aggiornamento non riuscito: ${error.message}` };

  if (decision === 'accepted' && suggestion.url !== null) {
    await supabase.from('citations').insert({
      project_id: suggestion.project_id,
      organization_id: organization.id,
      chapter_id: suggestion.chapter_id,
      url: suggestion.url,
      title: suggestion.title,
      publisher: suggestion.origin === 'biblioteca' ? 'Biblioteca del progetto' : null,
      is_official: suggestion.origin === 'catalogo_ufficiale',
      is_reachable: true,
      last_checked_at: new Date().toISOString(),
      note: `Accettata dalla ricerca automatica, riga ${suggestion.claim_line}.`,
    });
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: decision === 'accepted' ? 'source.accepted' : 'source.rejected',
    entityType: 'source_suggestion',
    entityId: suggestionId,
    metadata: { title: suggestion.title, url: suggestion.url, page: suggestion.page },
  });

  revalidatePath(`/projects/${suggestion.project_id}/sources`);
  return {
    ok: true,
    message: decision === 'accepted' ? 'Fonte accettata e citata.' : 'Proposta scartata.',
  };
}

// ---------------------------------------------------------------------------
// Ausiliari
// ---------------------------------------------------------------------------

/** Scrive i blocchi indicizzabili e aggiorna lo stato della fonte. */
async function saveChunks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    referenceId: string;
    organizationId: string;
    projectId: string | null;
    chunks: ReferenceChunk[];
    pageCount: number | null;
    warnings: string[];
  },
): Promise<string> {
  if (input.chunks.length > 0) {
    const rows = input.chunks.map((chunk) => ({
      reference_id: input.referenceId,
      organization_id: input.organizationId,
      project_id: input.projectId,
      chunk_index: chunk.chunkIndex,
      page: chunk.page,
      heading: chunk.heading,
      content: chunk.content,
      terms: chunk.terms,
    }));

    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('reference_chunks').insert(rows.slice(i, i + 200));
      if (error) {
        await supabase
          .from('reference_sources')
          .update({ status: 'failed', error_message: error.message })
          .eq('id', input.referenceId);
        return `Indicizzazione fallita: ${error.message}`;
      }
    }
  }

  const message = input.warnings.join(' ') || null;

  await supabase
    .from('reference_sources')
    .update({
      status: input.chunks.length > 0 ? 'indexed' : 'failed',
      chunk_count: input.chunks.length,
      page_count: input.pageCount,
      indexed_at: input.chunks.length > 0 ? new Date().toISOString() : null,
      error_message: message,
    })
    .eq('id', input.referenceId);

  return message ?? '';
}
