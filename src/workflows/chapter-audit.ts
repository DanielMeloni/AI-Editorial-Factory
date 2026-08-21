import { approvalHook } from './hooks';
import {
  applyDecision,
  auditSources,
  draftChapter,
  enrichWithLibrary,
  finishRun,
  verifyCitations,
  generateDiagrams,
  loadChapter,
  markStep,
  persistAudit,
  planVisuals,
  proposeRevision,
  requestApproval,
  updateVolumePreview,
  startNextGlobalChapter,
  verifyTechnical,
  type RunContext,
} from './chapter-audit-steps';

/**
 * Audit tecnico ed editoriale di un capitolo.
 *
 * Il workflow è durevole: ogni passaggio è registrato, l'esecuzione sopravvive
 * a un riavvio o a un nuovo deploy, e la sospensione in attesa dell'approvazione
 * umana non consuma risorse. Chiudere il browser non lo interrompe.
 *
 * Ordine dei passaggi:
 *   1. caricamento del capitolo e dell'ultima versione
 *   2. estrazione di titoli, codice, collegamenti e segnaposto
 *   3. individuazione delle affermazioni verificabili
 *   4. verifica dei riferimenti e ricerca delle fonti nell'indice ufficiale
 *   5. ricerca nella biblioteca del progetto: link e PDF caricati dall'autore
 *   5. analisi tecnica dei blocchi SQLX, SQL e JavaScript
 *   6. persistenza dell'audit
 *   7. proposta di revisione (nuova versione, mai una sovrascrittura)
 *   8. piano visuale
 *   9. generazione dei diagrammi deterministici
 *  10. richiesta di approvazione umana
 *  11. sospensione
 *  12. ripresa alla decisione
 *  13. salvataggio della versione approvata
 *  14. gli output editoriali arrivano con la Fase 6
 */

const TOTAL_STEPS = 14;

export interface ChapterAuditInput extends RunContext {
  /** Token opaco con cui riprendere l'esecuzione dopo la decisione umana. */
  resumeToken: string;
  globalSequence?: boolean;
}

export async function chapterAuditWorkflow(input: ChapterAuditInput) {
  'use workflow';

  const context: RunContext = {
    workflowRunId: input.workflowRunId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    chapterId: input.chapterId,
    actorId: input.actorId,
  };

  try {
    await markStep(context.workflowRunId, 'caricamento-capitolo', 1, TOTAL_STEPS);
    const loaded = await loadChapter(context);

    // La stesura precede l'audit: verificare un segnaposto significa
    // verificare niente, e chiedere un'approvazione su di esso significa
    // chiedere a una persona di decidere sul nulla.
    await markStep(context.workflowRunId, 'stesura-capitolo', 2, TOTAL_STEPS);
    const stesura = await draftChapter(context, loaded.chapter, loaded.versionId);

    await markStep(context.workflowRunId, 'verifica-tecnica', 3, TOTAL_STEPS);
    const technical = await verifyTechnical(context, stesura.chapter);

    await markStep(context.workflowRunId, 'verifica-fonti', 4, TOTAL_STEPS);
    const sources = await auditSources(context, stesura.chapter, technical.claims);

    await markStep(context.workflowRunId, 'ricerca-biblioteca', 5, TOTAL_STEPS);
    const library = await enrichWithLibrary(context, technical.claims, sources.suggestions);

    await markStep(context.workflowRunId, 'verifica-collegamenti', 6, TOTAL_STEPS);
    const links = await verifyCitations(context, sources.citations);

    await markStep(context.workflowRunId, 'salvataggio-audit', 7, TOTAL_STEPS);
    const audit = await persistAudit(
      context,
      technical,
      sources,
      library.suggestions,
      links.issues,
      links.verified,
    );

    await markStep(context.workflowRunId, 'proposta-revisione', 8, TOTAL_STEPS);
    const revision = await proposeRevision(
      context,
      stesura.chapter,
      [...technical.issues, ...sources.issues],
      library.suggestions,
      stesura.versionId,
    );

    // Se l'audit non ha trovato nulla da correggere resta comunque la stesura
    // da approvare: senza questo, un capitolo appena scritto arriverebbe alla
    // decisione senza nulla da confrontare.
    const versioneProposta = revision.versionId ?? stesura.versionId;

    await markStep(context.workflowRunId, 'piano-visuale', 9, TOTAL_STEPS);
    const visualPlan = await planVisuals(context, stesura.chapter, technical.dataformRefs);

    await markStep(context.workflowRunId, 'generazione-diagrammi', 10, TOTAL_STEPS);
    const diagrams = await generateDiagrams(
      context,
      stesura.chapter.title,
      technical.dataformRefs,
      loaded.isIncremental,
    );

    await markStep(context.workflowRunId, 'richiesta-approvazione', 11, TOTAL_STEPS);
    const reviewRequestId = await requestApproval(
      context,
      loaded.versionId,
      versioneProposta,
      input.resumeToken,
      `Capitolo scritto dalle fonti: ${stesura.chapter.contentMd.split(/\s+/).filter(Boolean).length} parole. ` +
        `${audit.issueCount} rilievi, ${audit.suggestions} fonti ufficiali proposte, ` +
        `${revision.changeCount} interventi proposti, ${diagrams.assetIds.length} diagrammi, ` +
        `${visualPlan.items.length} figure previste.` +
        (stesura.gaps.length > 0
          ? ` ${stesura.gaps.length} punti che le fonti non coprono: ${stesura.gaps.slice(0, 3).join('; ')}`
          : ''),
    );

    // La coda avanza quando il capitolo è pronto per la revisione, non quando
    // la persona ha finito di revisionarlo. Così la generazione resta
    // sequenziale, mentre revisione umana e generazione possono sovrapporsi.
    if (input.globalSequence) await startNextGlobalChapter(context);

    // --- Sospensione: si riprende solo con una decisione umana. -------------
    // Va segnalata come passaggio: per chi guarda, «in attesa» è
    // un'informazione, non un vuoto fra due righe.
    await markStep(context.workflowRunId, 'attesa-approvazione', 12, TOTAL_STEPS);
    const events = approvalHook.create({ token: input.resumeToken });

    let approvedVersionId: string | null = null;
    let decisione: 'approved' | 'rejected' | 'changes_requested' = 'changes_requested';

    for await (const event of events) {
      decisione = event.decision;
      const outcome = await applyDecision(
        context,
        reviewRequestId,
        versioneProposta,
        event.decision,
        event.note ?? null,
        event.decidedBy ?? null,
      );
      approvedVersionId = outcome.approvedVersionId;
      break;
    }

    await markStep(context.workflowRunId, 'salvataggio-versione', 13, TOTAL_STEPS);

    // Ultimo passaggio: il capitolo appena convalidato smette di essere un
    // capitolo a sé e diventa parte del libro. È il momento in cui il progresso
    // si vede — un elenco di capitoli approvati non lo mostra allo stesso modo.
    await markStep(context.workflowRunId, 'anteprima-volume', 14, TOTAL_STEPS);
    const anteprima = await updateVolumePreview(context);

    const esito = {
      decision: decisione,
      approvedVersionId,
      proposedVersionId: versioneProposta,
      draftedVersionId: stesura.versionId,
      draftGaps: stesura.gaps,
      previewChapters: anteprima.chapters,
      previewWords: anteprima.words,
      previewOk: anteprima.ok,
      reviewRequestId,
      issues: audit.issueCount,
      critical: audit.critical,
      high: audit.high,
      claims: technical.claims.length,
      citations: sources.citations.length,
      brokenLinks: links.broken,
      suggestedSources: audit.suggestions,
      unmatchedClaims:
        library.libraryEntries > 0 ? library.unmatched : sources.unmatchedClaims,
      libraryEntries: library.libraryEntries,
      diagrams: diagrams.assetIds.length,
      plannedVisuals: visualPlan.items.length,
      // Gli output editoriali (Markdown, HTML, PDF, lezione, articolo) sono
      // previsti dalla Fase 6: qui non vengono prodotti né dichiarati pronti.
      outputsPending: true,
    };

    await finishRun(
      context.workflowRunId,
      audit.critical > 0 ? 'completed_with_warnings' : 'completed',
      esito,
      null,
    );

    return esito;
  } catch (error) {
    await finishRun(context.workflowRunId, 'failed', null, {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
