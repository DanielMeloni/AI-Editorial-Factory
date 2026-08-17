import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { runAgent } from '@/lib/agents/runner';
import {
  sourceAuditorAgent,
  technicalVerifierAgent,
  technicalWriterAgent,
  visualPlanAgent,
} from '@/lib/agents/definitions';
import { analyzeMarkdown } from '@/lib/ingest/markdown';
import { buildProjectIndex } from '@/lib/sources/library';
import { mergeSuggestions, researchClaims } from '@/lib/sources/research';
import { extractConfigBlock } from '@/lib/agents/analysis/dataform';
import { buildDependencyDag } from '@/lib/visual/mermaid-dag';
import type {
  ChapterInput,
  Issue,
  RevisionOutput,
  SourceAuditOutput,
  SourceSuggestion,
  TechnicalVerifierOutput,
  VerifiableClaim,
  VisualPlanOutput,
} from '@/lib/agents/schemas';

/**
 * Step del workflow di audit.
 *
 * Ogni funzione marcata `'use step'` viene compilata in una rotta isolata, con
 * ritentativi automatici, e il workflow resta sospeso mentre gira. Input e
 * output attraversano il registro degli eventi: devono essere serializzabili.
 */

export interface RunContext {
  workflowRunId: string;
  organizationId: string;
  projectId: string;
  chapterId: string;
  actorId: string | null;
}

// ---------------------------------------------------------------------------
// 1 · Caricamento del capitolo e delle fonti collegate
// ---------------------------------------------------------------------------

export async function loadChapter(context: RunContext): Promise<{
  chapter: ChapterInput;
  versionId: string;
  isIncremental: boolean;
}> {
  'use step';

  const db = createAdminClient();

  const { data: chapter, error } = await db
    .from('chapters')
    .select('id, number, title, current_version_id, organization_id, project_id')
    .eq('id', context.chapterId)
    .single<{
      id: string;
      number: number | null;
      title: string;
      current_version_id: string | null;
      organization_id: string;
      project_id: string;
    }>();

  if (error || !chapter) throw new Error('Capitolo non trovato.');

  // Controllo di appartenenza esplicito: lo step usa il service role, che
  // ignora la RLS. La coerenza va riverificata qui.
  if (
    chapter.organization_id !== context.organizationId ||
    chapter.project_id !== context.projectId
  ) {
    throw new Error('Il capitolo non appartiene al progetto indicato.');
  }

  const { data: version } = await db
    .from('chapter_versions')
    .select('id, content_md')
    .eq('chapter_id', context.chapterId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; content_md: string }>();

  if (!version) throw new Error('Il capitolo non ha alcuna versione da analizzare.');

  const analysis = analyzeMarkdown(version.content_md);

  const isIncremental = analysis.codeBlocks.some((block) => {
    const config = extractConfigBlock(block.content);
    return config !== null && /\btype\s*:\s*["']incremental["']/.test(config);
  });

  return {
    chapter: {
      chapterId: chapter.id,
      number: chapter.number,
      title: chapter.title,
      contentMd: version.content_md,
      headings: analysis.headings.map((h) => ({ level: h.level, text: h.text, line: h.line })),
      codeBlocks: analysis.codeBlocks.map((b) => ({
        language: b.language,
        content: b.content,
        line: b.line,
      })),
      links: analysis.links,
      figures: analysis.figures.map((f) => ({ alt: f.alt, src: f.src, line: f.line })),
      placeholders: analysis.placeholders.map((p) => ({ description: p.description, line: p.line })),
    },
    versionId: version.id,
    isIncremental,
  };
}

// ---------------------------------------------------------------------------
// 2 · Analisi tecnica del codice e delle affermazioni
// ---------------------------------------------------------------------------

export async function verifyTechnical(
  context: RunContext,
  chapter: ChapterInput,
): Promise<TechnicalVerifierOutput> {
  'use step';

  const result = await runAgent(technicalVerifierAgent, chapter, {
    db: createAdminClient(),
    organizationId: context.organizationId,
    projectId: context.projectId,
    chapterId: context.chapterId,
    workflowRunId: context.workflowRunId,
    stepName: 'verifica-tecnica',
  });

  return result.output;
}

// ---------------------------------------------------------------------------
// 3 · Verifica dei riferimenti e ricerca automatica delle fonti mancanti
// ---------------------------------------------------------------------------

/**
 * Riceve le affermazioni individuate al passaggio precedente: senza di esse
 * potrebbe giudicare le fonti presenti, ma non cercare quelle che mancano.
 */
export async function auditSources(
  context: RunContext,
  chapter: ChapterInput,
  claims: VerifiableClaim[],
): Promise<SourceAuditOutput> {
  'use step';

  const result = await runAgent(sourceAuditorAgent, { ...chapter, claims }, {
    db: createAdminClient(),
    organizationId: context.organizationId,
    projectId: context.projectId,
    chapterId: context.chapterId,
    workflowRunId: context.workflowRunId,
    stepName: 'verifica-fonti',
  });

  return result.output;
}

// ---------------------------------------------------------------------------
// 3-bis · Biblioteca del progetto
// ---------------------------------------------------------------------------

/**
 * Aggiunge alle proposte le fonti che l'autore ha caricato: link e PDF.
 *
 * È un passaggio a sé perché l'agente resta puro — interroga la sola
 * documentazione ufficiale e non tocca il database — mentre la biblioteca vive
 * nelle tabelle del progetto. Le due ricerche usano lo stesso indice costruito
 * insieme, quindi i punteggi restano confrontabili e l'ordine dei candidati
 * significa qualcosa.
 */
export async function enrichWithLibrary(
  context: RunContext,
  claims: VerifiableClaim[],
  suggestions: SourceSuggestion[],
): Promise<{ suggestions: SourceSuggestion[]; unmatched: number; libraryEntries: number }> {
  'use step';

  const db = createAdminClient();
  const { index, libraryEntries } = await buildProjectIndex(
    db,
    context.organizationId,
    context.projectId,
  );

  // Nessuna fonte caricata: non c'è nulla da aggiungere, e ricalcolare
  // sull'indice ufficiale darebbe esattamente ciò che si ha già.
  if (libraryEntries === 0) {
    return { suggestions, unmatched: 0, libraryEntries: 0 };
  }

  const research = researchClaims(claims, index);

  return {
    suggestions: mergeSuggestions(suggestions, research.suggestions),
    unmatched: research.unmatched,
    libraryEntries,
  };
}

// ---------------------------------------------------------------------------
// 4 · Persistenza dell'audit
// ---------------------------------------------------------------------------

export async function persistAudit(
  context: RunContext,
  technical: TechnicalVerifierOutput,
  sources: SourceAuditOutput,
  suggestions: SourceSuggestion[],
): Promise<{ issueCount: number; critical: number; high: number; suggestions: number }> {
  'use step';

  const db = createAdminClient();
  const issues: Issue[] = [...technical.issues, ...sources.issues];

  // Una riesecuzione sostituisce i rilievi del workflow precedente, non quelli
  // di altre esecuzioni: il filtro è sull'identificativo del run.
  await db.from('verification_issues').delete().eq('workflow_run_id', context.workflowRunId);

  if (issues.length > 0) {
    const rows = issues.map((issue) => ({
      project_id: context.projectId,
      organization_id: context.organizationId,
      chapter_id: context.chapterId,
      workflow_run_id: context.workflowRunId,
      kind: issue.kind,
      severity: issue.severity,
      status: 'open',
      title: issue.title,
      detail: issue.detail,
      suggestion: issue.suggestion,
      location: issue.location,
      evidence: issue.evidence,
    }));

    for (let i = 0; i < rows.length; i += 100) {
      await db.from('verification_issues').insert(rows.slice(i, i + 100));
    }
  }

  // Le citazioni diventano righe consultabili e ricontrollabili nel tempo.
  await db.from('citations').delete().eq('chapter_id', context.chapterId);
  if (sources.citations.length > 0) {
    const now = new Date().toISOString();
    await db.from('citations').insert(
      sources.citations.map((citation) => ({
        project_id: context.projectId,
        organization_id: context.organizationId,
        chapter_id: context.chapterId,
        url: citation.url,
        title: citation.indexedTitle ?? citation.text ?? null,
        publisher: citation.domain || null,
        is_official: citation.isOfficial,
        note: citation.note,
        // Il controllo è avvenuto contro l'indice curato, non con una chiamata
        // HTTP: `is_reachable` resta nullo per ciò che non è stato interrogato.
        is_reachable: citation.inIndex ? true : null,
        last_checked_at: now,
      })),
    );
  }

  // Le fonti proposte restano righe distinte: una proposta non è una citazione
  // finché qualcuno non l'accetta.
  await db.from('source_suggestions').delete().eq('workflow_run_id', context.workflowRunId);

  const suggestionRows = suggestions.flatMap((suggestion) =>
    suggestion.candidates.map((candidate, index) => ({
      project_id: context.projectId,
      organization_id: context.organizationId,
      chapter_id: context.chapterId,
      workflow_run_id: context.workflowRunId,
      claim_line: suggestion.line,
      claim_excerpt: suggestion.statement,
      category: suggestion.category,
      url: candidate.url,
      title: candidate.title,
      section: candidate.section,
      score: candidate.score,
      rank: index + 1,
      matched_terms: candidate.matchedTerms,
      origin: candidate.origin,
      reference_id: candidate.referenceId,
      page: candidate.page,
      status: 'proposed',
    })),
  );

  for (let i = 0; i < suggestionRows.length; i += 100) {
    await db.from('source_suggestions').insert(suggestionRows.slice(i, i + 100));
  }

  return {
    issueCount: issues.length,
    critical: issues.filter((i) => i.severity === 'critical').length,
    high: issues.filter((i) => i.severity === 'high').length,
    suggestions: suggestions.length,
  };
}

// ---------------------------------------------------------------------------
// 5 · Proposta di revisione — mai una sovrascrittura
// ---------------------------------------------------------------------------

export async function proposeRevision(
  context: RunContext,
  chapter: ChapterInput,
  issues: Issue[],
  suggestions: SourceSuggestion[],
  baseVersionId: string,
): Promise<{ versionId: string | null; changeCount: number; summary: string }> {
  'use step';

  const db = createAdminClient();

  const result = await runAgent(
    technicalWriterAgent,
    { ...chapter, issues, suggestions },
    {
      db,
      organizationId: context.organizationId,
      projectId: context.projectId,
      chapterId: context.chapterId,
      workflowRunId: context.workflowRunId,
      stepName: 'proposta-revisione',
    },
  );

  const revision: RevisionOutput = result.output;

  // Nessun intervento: non si crea una versione identica all'originale.
  if (revision.changes.length === 0) {
    return { versionId: null, changeCount: 0, summary: revision.summary };
  }

  const { data: last } = await db
    .from('chapter_versions')
    .select('version_no')
    .eq('chapter_id', context.chapterId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle<{ version_no: number }>();

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(revision.contentMd),
  );
  const contentHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const { data: created, error } = await db
    .from('chapter_versions')
    .insert({
      chapter_id: context.chapterId,
      project_id: context.projectId,
      organization_id: context.organizationId,
      version_no: (last?.version_no ?? 0) + 1,
      origin: 'ai_proposal',
      content_md: revision.contentMd,
      content_hash: contentHash,
      summary: revision.summary,
      word_count: revision.contentMd.split(/\s+/).filter(Boolean).length,
      parent_version_id: baseVersionId,
      workflow_run_id: context.workflowRunId,
      agent_run_id: result.agentRunId,
      created_by: context.actorId,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !created) throw new Error(`Salvataggio della proposta fallito: ${error?.message ?? ''}`);

  return { versionId: created.id, changeCount: revision.changes.length, summary: revision.summary };
}

// ---------------------------------------------------------------------------
// 6 · Piano visuale
// ---------------------------------------------------------------------------

export async function planVisuals(
  context: RunContext,
  chapter: ChapterInput,
  dataformRefs: string[],
): Promise<VisualPlanOutput> {
  'use step';

  const result = await runAgent(
    visualPlanAgent,
    { ...chapter, dataformRefs },
    {
      db: createAdminClient(),
      organizationId: context.organizationId,
      projectId: context.projectId,
      chapterId: context.chapterId,
      workflowRunId: context.workflowRunId,
      stepName: 'piano-visuale',
    },
  );

  return result.output;
}

// ---------------------------------------------------------------------------
// 7 · Diagrammi deterministici
// ---------------------------------------------------------------------------

export async function generateDiagrams(
  context: RunContext,
  chapterTitle: string,
  dataformRefs: string[],
  isIncremental: boolean,
): Promise<{ assetIds: string[]; mermaid: string | null }> {
  'use step';

  const db = createAdminClient();
  const diagram = buildDependencyDag({
    target: chapterTitle,
    dependencies: dataformRefs,
    isIncremental,
  });

  const { data: existing } = await db
    .from('visual_assets')
    .select('version')
    .eq('chapter_id', context.chapterId)
    .eq('kind', 'diagram')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();

  const { data: asset, error } = await db
    .from('visual_assets')
    .insert({
      project_id: context.projectId,
      organization_id: context.organizationId,
      chapter_id: context.chapterId,
      kind: 'diagram',
      generator: 'mermaid',
      // Anche un diagramma esatto richiede l'occhio umano prima di finire nel libro.
      status: 'pending_approval',
      version: (existing?.version ?? 0) + 1,
      title: diagram.title,
      caption: diagram.caption,
      alt_text: diagram.altText,
      mermaid_source: diagram.mermaid,
      created_by: context.actorId,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !asset) throw new Error(`Salvataggio del diagramma fallito: ${error?.message ?? ''}`);

  return { assetIds: [asset.id], mermaid: diagram.mermaid };
}

// ---------------------------------------------------------------------------
// 8 · Richiesta di approvazione
// ---------------------------------------------------------------------------

export async function requestApproval(
  context: RunContext,
  baseVersionId: string,
  proposedVersionId: string | null,
  resumeToken: string,
  summary: string,
): Promise<string> {
  'use step';

  const db = createAdminClient();

  const { data, error } = await db
    .from('review_requests')
    .insert({
      project_id: context.projectId,
      organization_id: context.organizationId,
      chapter_id: context.chapterId,
      workflow_run_id: context.workflowRunId,
      base_version_id: baseVersionId,
      proposed_version_id: proposedVersionId,
      status: 'pending',
      title: 'Revisione proposta dall’audit tecnico',
      summary,
      resume_token: resumeToken,
      requested_by: context.actorId,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) throw new Error(`Creazione della richiesta di revisione fallita: ${error?.message ?? ''}`);

  await db
    .from('workflow_runs')
    .update({ status: 'awaiting_approval', current_step: 'attesa-approvazione' })
    .eq('id', context.workflowRunId);

  await db.from('chapters').update({ status: 'in_review' }).eq('id', context.chapterId);

  return data.id;
}

// ---------------------------------------------------------------------------
// 9 · Esito della decisione umana
// ---------------------------------------------------------------------------

export async function applyDecision(
  context: RunContext,
  reviewRequestId: string,
  _proposedVersionIdAtCreation: string | null,
  decision: 'approved' | 'rejected' | 'changes_requested',
  note: string | null,
  decidedBy: string | null,
): Promise<{ approvedVersionId: string | null }> {
  'use step';

  const db = createAdminClient();
  const now = new Date().toISOString();

  // La proposta viene riletta adesso, non usata come era al momento della
  // richiesta: fra i due istanti il revisore può aver accettato solo alcune
  // modifiche o intervenuto a mano, generando una versione diversa.
  const { data: current } = await db
    .from('review_requests')
    .select('proposed_version_id')
    .eq('id', reviewRequestId)
    .maybeSingle<{ proposed_version_id: string | null }>();

  const proposedVersionId = current?.proposed_version_id ?? _proposedVersionIdAtCreation;

  await db
    .from('review_requests')
    .update({ status: decision, decided_at: now, decided_by: decidedBy, decision_note: note })
    .eq('id', reviewRequestId);

  if (decision !== 'approved' || !proposedVersionId) {
    await db.from('chapters').update({ status: 'draft' }).eq('id', context.chapterId);
    return { approvedVersionId: null };
  }

  // La proposta approvata diventa la versione corrente. L'originale resta
  // intatto: è una riga distinta, protetta da trigger.
  await db
    .from('chapter_versions')
    .update({ origin: 'approved', is_approved: true, approved_by: decidedBy, approved_at: now })
    .eq('id', proposedVersionId);

  await db
    .from('chapters')
    .update({ current_version_id: proposedVersionId, status: 'approved' })
    .eq('id', context.chapterId);

  return { approvedVersionId: proposedVersionId };
}

// ---------------------------------------------------------------------------
// Aggiornamento dello stato di avanzamento
// ---------------------------------------------------------------------------

export async function markStep(
  workflowRunId: string,
  step: string,
  completed: number,
  total: number,
): Promise<void> {
  'use step';

  await createAdminClient()
    .from('workflow_runs')
    .update({ current_step: step, completed_steps: completed, total_steps: total, status: 'running' })
    .eq('id', workflowRunId);
}

export async function finishRun(
  workflowRunId: string,
  status: 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled',
  output: Record<string, unknown> | null,
  error: Record<string, unknown> | null,
): Promise<void> {
  'use step';

  await createAdminClient()
    .from('workflow_runs')
    .update({ status, output, error, finished_at: new Date().toISOString() })
    .eq('id', workflowRunId);
}
