import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { runAgent } from '@/lib/agents/runner';
import {
  chapterApparatusAgent,
  chapterPlanAgent,
  chapterSectionAgent,
  sourceAuditorAgent,
  technicalVerifierAgent,
  technicalWriterAgent,
  visualPlanAgent,
} from '@/lib/agents/definitions';
import { analyzeMarkdown } from '@/lib/ingest/markdown';
import { istruzioniEditoriali } from '@/lib/editorial/direzione';
import { rebuildVolumePreviewWith } from '@/lib/publish/preview';
import { buildProjectIndex } from '@/lib/sources/library';
import { mergeSuggestions, researchClaims } from '@/lib/sources/research';
import { verifyUrls } from '@/lib/sources/verify-url';
import { extractConfigBlock } from '@/lib/agents/analysis/dataform';
import { buildDependencyDag } from '@/lib/visual/mermaid-dag';
import type {
  ChapterApparatusOutput,
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
// 1-bis · Stesura del capitolo
// ---------------------------------------------------------------------------

/**
 * Compone il capitolo dalle parti.
 *
 * L'assemblaggio è codice, non un'ulteriore richiesta al modello: l'ordine
 * delle sezioni, la numerazione e la forma dell'apparato sono decisioni
 * editoriali già prese, e farle rieseguire a un modello le renderebbe incerte
 * a ogni esecuzione.
 */
function componiCapitolo(
  numero: number | null,
  titolo: string,
  obiettivi: string[],
  corpo: string,
  apparato: ChapterApparatusOutput,
): string {
  const parti: string[] = [
    `# ${numero !== null ? `Capitolo ${numero} - ` : ''}${titolo}`,
    '',
    '> **OBIETTIVI DEL CAPITOLO**',
    '>',
    ...obiettivi.map((obiettivo) => `> - ${obiettivo}`),
    '',
    corpo,
    '',
  ];

  if (apparato.bestPractices.length > 0) {
    parti.push('## Best practice', '', ...apparato.bestPractices.map((voce) => `- ${voce}`), '');
  }
  if (apparato.commonErrors.length > 0) {
    parti.push('## Errori comuni', '', ...apparato.commonErrors.map((voce) => `- ${voce}`), '');
  }

  parti.push('## Riassunto', '', apparato.summary, '');
  parti.push('## Punti chiave', '', ...apparato.keyPoints.map((voce) => `- ${voce}`), '');

  if (apparato.quiz.length > 0) {
    parti.push('## Quiz', '', 'Per ogni domanda una sola risposta è corretta.', '');
    apparato.quiz.forEach((domanda, indice) => {
      parti.push(`${indice + 1}. **${domanda.question}**`, '');
      domanda.options.forEach((opzione, i) => {
        parti.push(`   ${String.fromCharCode(97 + i)}) ${opzione}`);
      });
      parti.push('');
    });
    // Le soluzioni stanno in fondo e non accanto alla domanda: un quiz con la
    // risposta a vista non verifica nulla.
    parti.push(
      '**Soluzioni:** ' +
        apparato.quiz
          .map((domanda, indice) => `${indice + 1}-${String.fromCharCode(97 + domanda.correct)}`)
          .join(', '),
      '',
    );
  }

  if (apparato.lab.trim()) parti.push('## Laboratorio', '', apparato.lab.trim(), '');

  // Nessuna sezione di riferimenti: le fonti dell'opera stanno tutte nel
  // capitolo di bibliografia, dove si aggiornano in un posto solo invece che
  // in trenta code di capitolo.

  return parti.join('\n');
}

/**
 * Scrive il capitolo per intero prima che l'audit lo esamini.
 *
 * L'ordine non è un dettaglio: verificare un segnaposto significa verificare
 * niente, e chiedere un'approvazione su trentacinque parole significa chiedere
 * a una persona di decidere sul nulla.
 *
 * La stesura avviene in tre passaggi — piano, sezioni, apparato — perché un
 * capitolo completo non entra in una risposta sola: chiederlo in una volta
 * produce un capitolo che si accorcia da solo per starci dentro.
 *
 * La versione creata qui non sostituisce quella di partenza: diventa la
 * corrente, ma il segnaposto resta come radice della catena, ed è quello che il
 * revisore vedrà a sinistra nel confronto.
 */
export async function draftChapter(
  context: RunContext,
  chapter: ChapterInput,
  baseVersionId: string,
): Promise<{ chapter: ChapterInput; versionId: string; gaps: string[]; grounded: boolean }> {
  'use step';

  const db = createAdminClient();

  const [{ data: chapterRow }, { data: project }] = await Promise.all([
    db.from('chapters').select('part_id').eq('id', context.chapterId)
      .maybeSingle<{ part_id: string | null }>(),
    db.from('projects').select('language, level, tone, register, style_notes')
      .eq('id', context.projectId)
      .maybeSingle<{
        language: string;
        level: 'base' | 'intermediate' | 'advanced';
        tone: string;
        register: string;
        style_notes: string | null;
      }>(),
  ]);

  const { data: part } = chapterRow?.part_id
    ? await db.from('publication_parts').select('title').eq('id', chapterRow.part_id)
        .maybeSingle<{ title: string }>()
    : { data: null };

  // Le stesse fonti che hanno prodotto la struttura producono il testo: un
  // capitolo non può poggiare su materiale che l'indice non conosceva.
  const [{ data: references }, { data: referenceChunks }, { data: sourceChunks }] =
    await Promise.all([
      db.from('reference_sources').select('title, publisher, url')
        .or(`project_id.eq.${context.projectId},project_id.is.null`)
        .neq('status', 'proposed').limit(60),
      db.from('reference_chunks').select('heading, content')
        .or(`project_id.eq.${context.projectId},project_id.is.null`)
        .order('chunk_index', { ascending: true }).limit(120),
      db.from('source_chunks').select('heading_path, content')
        .eq('project_id', context.projectId)
        .order('chunk_index', { ascending: true }).limit(120),
    ]);

  const evidence = [
    ...(referenceChunks ?? []).map(
      (blocco) => `${blocco.heading ? `## ${blocco.heading}\n` : ''}${blocco.content}`,
    ),
    ...(sourceChunks ?? []).map(
      (blocco) =>
        `${blocco.heading_path?.length ? `## ${blocco.heading_path.join(' > ')}\n` : ''}${blocco.content}`,
    ),
  ].join('\n\n').slice(0, 60_000);

  // L'obiettivo è ciò che la fase di struttura ha promesso per questo capitolo.
  const obiettivo = chapter.contentMd.match(/##\s*Obiettivo\s*\n+([\s\S]*?)(?:\n#{1,2}\s|$)/i);

  const ingresso = {
    chapterId: chapter.chapterId,
    number: chapter.number,
    title: chapter.title,
    objective: (obiettivo?.[1] ?? '').trim().slice(0, 2000),
    partTitle: part?.title ?? null,
    language: project?.language ?? 'it',
    // Senza questo, tre volumi sullo stesso argomento produrrebbero lo stesso
    // capitolo con tre titoli diversi.
    direzione: istruzioniEditoriali({
      level: project?.level ?? 'base',
      tone: project?.tone ?? 'didattico',
      register: project?.register ?? 'tecnico_operativo',
      styleNotes: project?.style_notes ?? null,
    }),
    references: (references ?? []).map((riferimento) => ({
      title: riferimento.title,
      publisher: riferimento.publisher ?? null,
      url: riferimento.url ?? null,
    })),
    evidence,
    existingContent: chapter.contentMd,
  };

  const contesto = {
    db,
    organizationId: context.organizationId,
    projectId: context.projectId,
    chapterId: context.chapterId,
    workflowRunId: context.workflowRunId,
    stepName: 'stesura-capitolo',
  };

  const gaps: string[] = [];

  const piano = (await runAgent(chapterPlanAgent, ingresso, contesto)).output;
  const scaletta = piano.sections.map((sezione) => sezione.title);

  // Una sezione per volta e in ordine: ognuna vede la scaletta intera, così non
  // ripete ciò che è già stato detto né anticipa ciò che verrà.
  const sezioni: string[] = [];
  for (const [indice, sezione] of piano.sections.entries()) {
    const scritta = (
      await runAgent(
        chapterSectionAgent,
        {
          ...ingresso,
          sectionTitle: sezione.title,
          sectionIntent: sezione.intent,
          needsCode: sezione.needsCode,
          needsFigure: sezione.needsFigure,
          sectionNumber: indice + 1,
          outline: scaletta,
          objectives: piano.objectives,
        },
        contesto,
      )
    ).output;
    sezioni.push(scritta.contentMd.trim());
    gaps.push(...scritta.gaps);
  }

  const corpo = sezioni.join('\n\n');

  // L'apparato riceve il corpo già scritto: un riassunto dedotto dalla scaletta
  // riassumerebbe le intenzioni, non il capitolo.
  const apparato = (
    await runAgent(
      chapterApparatusAgent,
      { ...ingresso, objectives: piano.objectives, outline: scaletta, body: corpo },
      contesto,
    )
  ).output;
  gaps.push(...apparato.gaps);

  const contentMd = componiCapitolo(
    chapter.number,
    chapter.title,
    piano.objectives,
    corpo,
    apparato,
  );

  const { data: last } = await db
    .from('chapter_versions')
    .select('version_no')
    .eq('chapter_id', context.chapterId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle<{ version_no: number }>();

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contentMd));
  const contentHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  const analysis = analyzeMarkdown(contentMd);
  const wordCount = contentMd.split(/\s+/).filter(Boolean).length;

  const { data: created, error } = await db
    .from('chapter_versions')
    .insert({
      chapter_id: context.chapterId,
      project_id: context.projectId,
      organization_id: context.organizationId,
      version_no: (last?.version_no ?? 0) + 1,
      origin: 'ai_proposal',
      content_md: contentMd,
      content_hash: contentHash,
      summary:
        `Capitolo scritto in ${piano.sections.length} sezioni` +
        `${gaps.length > 0 ? `, con ${gaps.length} punti non coperti dalle fonti` : ''}.`,
      word_count: wordCount,
      parent_version_id: baseVersionId,
      workflow_run_id: context.workflowRunId,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !created) throw new Error(error?.message ?? 'Stesura non registrata.');

  await db
    .from('chapters')
    .update({
      current_version_id: created.id,
      status: 'in_review',
      word_count: wordCount,
      code_block_count: analysis.codeBlocks.length,
      heading_count: analysis.headings.length,
      figure_count: analysis.figures.length,
      placeholder_count: analysis.placeholders.length,
      link_count: analysis.links.length,
    })
    .eq('id', context.chapterId);

  return {
    chapter: {
      ...chapter,
      contentMd,
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
    versionId: created.id,
    gaps,
    grounded: gaps.length === 0,
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
 *
 * Se il capitolo non offre né collegamenti né affermazioni, l'agente non viene
 * interpellato: con le mani vuote dedurrebbe dal titolo affermazioni che nel
 * testo non ci sono, e un elenco verosimile è peggio di un elenco vuoto perché
 * sembra un risultato.
 */
export async function auditSources(
  context: RunContext,
  chapter: ChapterInput,
  claims: VerifiableClaim[],
): Promise<SourceAuditOutput> {
  'use step';

  if (chapter.links.length === 0 && claims.length === 0) {
    return {
      citations: [],
      suggestions: [],
      unmatchedClaims: 0,
      issues: [
        {
          kind: 'source',
          severity: 'low',
          title: 'Capitolo senza contenuto verificabile',
          detail:
            'Il capitolo non contiene collegamenti né affermazioni tecniche da sostenere con una ' +
            'fonte. La verifica dei riferimenti non è stata eseguita: non c’è nulla da verificare, ' +
            'e nulla è stato dedotto dal titolo.',
          suggestion: 'Scrivere il capitolo, poi ripetere l’audit.',
          location: { line: null, heading: null, excerpt: null },
          evidence: [],
        },
      ],
      // L'esito non è incerto: l'assenza è un fatto constatato, non una stima.
      confidence: 1,
      summary: 'Nessun collegamento e nessuna affermazione da verificare: audit delle fonti non eseguito.',
    };
  }

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
// 3-ter · Verifica dei collegamenti citati
// ---------------------------------------------------------------------------

/**
 * Apre i collegamenti del capitolo e riferisce che cosa ha trovato.
 *
 * Senza questo passaggio l'audit può solo dire «questa pagina non è nel mio
 * indice», che è un'affermazione su di sé, non sul mondo: una pagina può
 * esistere benissimo senza essere censita. Un sospetto del genere, presentato
 * come rilievo, fa perdere tempo al revisore e — peggio — insegna a non fidarsi
 * dei rilievi.
 *
 * Aprendo l'indirizzo la domanda cambia: non «lo conosco?» ma «risponde?».
 * Alla prima nessuno è tenuto a rispondere; alla seconda risponde il web.
 */
export async function verifyCitations(
  _context: RunContext,
  citations: SourceAuditOutput['citations'],
): Promise<{
  issues: Issue[];
  verified: { url: string; status: number | null; ok: boolean; title: string | null }[];
  broken: number;
}> {
  'use step';

  const daControllare = citations.filter((citation) => citation.verification !== 'non_valida');
  if (daControllare.length === 0) return { issues: [], verified: [], broken: 0 };

  const esiti = await verifyUrls(daControllare.map((citation) => citation.url));
  const issues: Issue[] = [];
  const verified: { url: string; status: number | null; ok: boolean; title: string | null }[] = [];

  for (let i = 0; i < esiti.length; i += 1) {
    const esito = esiti[i]!;
    const citation = daControllare[i]!;

    verified.push({
      url: citation.url,
      status: esito.status,
      ok: esito.ok,
      title: esito.title,
    });

    if (esito.ok) {
      // Pagina ufficiale che risponde ma non è censita: non è un problema del
      // capitolo, è una lacuna del nostro indice. Va detto come tale.
      if (citation.isOfficial && !citation.inIndex) {
        issues.push({
          kind: 'source',
          severity: 'info',
          title: 'Pagina ufficiale non ancora censita',
          detail:
            `${citation.url} risponde ${esito.status} e il titolo è «${esito.title ?? '—'}». ` +
            'Il riferimento è valido: manca soltanto dall’indice curato.',
          suggestion: 'Valutare l’aggiunta a catalog.data.ts con npm run sources:refresh.',
          location: { line: citation.line || null, heading: null, excerpt: citation.url },
          evidence: [citation.url],
        });
      }
      continue;
    }

    issues.push({
      kind: 'source',
      severity: 'high',
      title: 'Collegamento non raggiungibile',
      detail:
        `${citation.url} non risponde` +
        (esito.status !== null ? ` (stato ${esito.status}).` : '.') +
        ' Un collegamento morto in un manuale stampato non è correggibile.',
      suggestion: esito.note ?? 'Aprire il collegamento e sostituirlo.',
      location: { line: citation.line || null, heading: null, excerpt: citation.url },
      evidence: [citation.url],
    });
  }

  return { issues, verified, broken: issues.filter((i) => i.severity === 'high').length };
}

// ---------------------------------------------------------------------------
// 4 · Persistenza dell'audit
// ---------------------------------------------------------------------------

export async function persistAudit(
  context: RunContext,
  technical: TechnicalVerifierOutput,
  sources: SourceAuditOutput,
  suggestions: SourceSuggestion[],
  linkIssues: Issue[],
  linkChecks: { url: string; status: number | null; ok: boolean; title: string | null }[],
): Promise<{ issueCount: number; critical: number; high: number; suggestions: number }> {
  'use step';

  const db = createAdminClient();

  // Il sospetto «pagina non censita» viene rimosso: al suo posto arriva l'esito
  // di chi l'ha aperta davvero. Tenere entrambi significherebbe far leggere al
  // revisore un dubbio e la sua risposta, nell'ordine sbagliato.
  const senzaSospetti = sources.issues.filter(
    (issue) => issue.title !== 'Riferimento ufficiale da verificare',
  );

  const issues: Issue[] = [...technical.issues, ...senzaSospetti, ...linkIssues].map((issue) => ({
    ...issue,
    // «riga 0» non esiste: le righe partono da 1. Uno zero significa «non
    // determinata», e dirlo così evita di mandare il revisore a cercare il nulla.
    location: { ...issue.location, line: issue.location.line === 0 ? null : issue.location.line },
  }));

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
        // Ora `is_reachable` dice ciò che dovrebbe dire: se la pagina ha
        // risposto quando è stata aperta. Nullo solo per ciò che non è stato
        // interrogato.
        http_status: linkChecks.find((c) => c.url === citation.url)?.status ?? null,
        is_reachable: linkChecks.find((c) => c.url === citation.url)?.ok ?? null,
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

// ---------------------------------------------------------------------------
// 11 · Anteprima del volume
// ---------------------------------------------------------------------------

/**
 * Aggiunge il capitolo appena convalidato all'anteprima del volume.
 *
 * È l'ultimo passaggio, e non è un'esportazione: è il momento in cui il lavoro
 * appena approvato smette di essere un capitolo a sé e diventa parte del libro.
 * Vedere il volume crescere dopo ogni approvazione è ciò che rende visibile il
 * progresso — un elenco di capitoli approvati non lo mostra allo stesso modo.
 *
 * Il fallimento qui non annulla l'approvazione: la decisione umana è già presa
 * e registrata, e un PDF che non si compone è un inconveniente, non un motivo
 * per rimettere in discussione ciò che una persona ha deciso.
 */
export async function updateVolumePreview(
  context: RunContext,
): Promise<{ chapters: number; words: number; ok: boolean; message: string }> {
  'use step';

  try {
    const esito = await rebuildVolumePreviewWith(createAdminClient(), {
      projectId: context.projectId,
      organizationId: context.organizationId,
      actorId: context.actorId,
    });

    return {
      ok: esito.ok,
      chapters: esito.chapters ?? 0,
      words: esito.words ?? 0,
      message: esito.message,
    };
  } catch (error) {
    return {
      ok: false,
      chapters: 0,
      words: 0,
      message: `Anteprima non aggiornata: ${(error as Error).message}`,
    };
  }
}
