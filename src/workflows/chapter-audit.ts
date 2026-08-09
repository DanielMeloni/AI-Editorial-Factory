import { approvalHook } from './hooks';
import {
  applyDecision,
  auditSources,
  finishRun,
  generateDiagrams,
  loadChapter,
  markStep,
  persistAudit,
  planVisuals,
  proposeRevision,
  requestApproval,
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
 *   4. verifica dei riferimenti alla documentazione
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

const TOTAL_STEPS = 13;

export interface ChapterAuditInput extends RunContext {
  /** Token opaco con cui riprendere l'esecuzione dopo la decisione umana. */
  resumeToken: string;
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

    await markStep(context.workflowRunId, 'verifica-tecnica', 3, TOTAL_STEPS);
    const technical = await verifyTechnical(context, loaded.chapter);

    await markStep(context.workflowRunId, 'verifica-fonti', 4, TOTAL_STEPS);
    const sources = await auditSources(context, loaded.chapter);

    await markStep(context.workflowRunId, 'salvataggio-audit', 6, TOTAL_STEPS);
    const audit = await persistAudit(context, technical, sources);

    await markStep(context.workflowRunId, 'proposta-revisione', 7, TOTAL_STEPS);
    const revision = await proposeRevision(
      context,
      loaded.chapter,
      [...technical.issues, ...sources.issues],
      loaded.versionId,
    );

    await markStep(context.workflowRunId, 'piano-visuale', 8, TOTAL_STEPS);
    const visualPlan = await planVisuals(context, loaded.chapter, technical.dataformRefs);

    await markStep(context.workflowRunId, 'generazione-diagrammi', 9, TOTAL_STEPS);
    const diagrams = await generateDiagrams(
      context,
      loaded.chapter.title,
      technical.dataformRefs,
      loaded.isIncremental,
    );

    await markStep(context.workflowRunId, 'richiesta-approvazione', 10, TOTAL_STEPS);
    const reviewRequestId = await requestApproval(
      context,
      loaded.versionId,
      revision.versionId,
      input.resumeToken,
      `${audit.issueCount} rilievi, ${revision.changeCount} interventi proposti, ` +
        `${diagrams.assetIds.length} diagrammi, ${visualPlan.items.length} figure previste.`,
    );

    // --- Sospensione: si riprende solo con una decisione umana. -------------
    const events = approvalHook.create({ token: input.resumeToken });

    let approvedVersionId: string | null = null;
    let decisione: 'approved' | 'rejected' | 'changes_requested' = 'changes_requested';

    for await (const event of events) {
      decisione = event.decision;
      const outcome = await applyDecision(
        context,
        reviewRequestId,
        revision.versionId,
        event.decision,
        event.note ?? null,
        event.decidedBy ?? null,
      );
      approvedVersionId = outcome.approvedVersionId;
      break;
    }

    await markStep(context.workflowRunId, 'salvataggio-versione', 13, TOTAL_STEPS);

    const esito = {
      decision: decisione,
      approvedVersionId,
      proposedVersionId: revision.versionId,
      reviewRequestId,
      issues: audit.issueCount,
      critical: audit.critical,
      high: audit.high,
      claims: technical.claims.length,
      citations: sources.citations.length,
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
