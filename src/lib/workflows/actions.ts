'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { start } from 'workflow/api';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { recordAudit } from '@/lib/security/audit';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { getServerEnv } from '@/lib/env';
import { chapterAuditWorkflow } from '@/workflows/chapter-audit';
import { approvalHook } from '@/workflows/hooks';
import { rebuildVolumePreviewWith } from '@/lib/publish/preview';

/**
 * Comandi sui workflow: avvio, annullamento, ritentativo, decisione.
 *
 * L'autorizzazione avviene qui, con la sessione dell'utente e la RLS attiva.
 * Solo dopo la verifica il workflow parte con privilegi di servizio.
 */

export interface CommandResult {
  ok: boolean;
  message: string;
  workflowRunId?: string;
}

const CHAPTER_AUDIT = 'chapter-audit';

export async function startChapterAudit(chapterId: string, globalSequence = false): Promise<CommandResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  // Lettura con la sessione dell'utente: se la RLS non la consente, il capitolo
  // semplicemente non esiste per lui.
  const { data: chapter } = await supabase
    .from('chapters')
    .select('id, project_id, organization_id, title')
    .eq('id', chapterId)
    .maybeSingle<{ id: string; project_id: string; organization_id: string; title: string }>();

  if (!chapter || chapter.organization_id !== organization.id) {
    return { ok: false, message: 'Capitolo non trovato.' };
  }

  // Un solo audit alla volta per capitolo: due esecuzioni parallele
  // produrrebbero due proposte concorrenti sulla stessa base.
  const { data: attivo } = await supabase
    .from('workflow_runs')
    .select('id, status')
    .eq('chapter_id', chapterId)
    .in('status', ['queued', 'running', 'awaiting_approval'])
    .maybeSingle<{ id: string; status: string }>();

  if (attivo) {
    return {
      ok: false,
      message:
        attivo.status === 'awaiting_approval'
          ? 'Esiste già una revisione in attesa di approvazione per questo capitolo.'
          : 'Un audit è già in corso su questo capitolo.',
      workflowRunId: attivo.id,
    };
  }

  const limite = await checkRateLimit(supabase, 'workflowStart', organization.id);
  if (!limite.allowed) return { ok: false, message: limite.message };

  if (!getServerEnv().SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      message:
        'SUPABASE_SERVICE_ROLE_KEY non configurata: gli step del workflow non potrebbero scrivere. Aggiungila a .env.local.',
    };
  }

  const resumeToken = randomUUID();

  const { data: run, error } = await supabase
    .from('workflow_runs')
    .insert({
      project_id: chapter.project_id,
      organization_id: organization.id,
      chapter_id: chapterId,
      kind: CHAPTER_AUDIT,
      status: 'queued',
      total_steps: 13,
      input: { chapterTitle: chapter.title, resumeToken, globalSequence },
      started_by: user.id,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !run) {
    return { ok: false, message: 'Registrazione del workflow non riuscita.' };
  }

  // Il nuovo run esiste: soltanto ora si può rimuovere lo storico precedente
  // senza rischiare di lasciare il capitolo privo di audit se l'inserimento
  // fallisce. Le versioni del manoscritto non vengono eliminate: sono storia
  // editoriale, non log di esecuzione.
  const admin = createAdminClient();
  const { data: precedenti, error: letturaPrecedentiError } = await admin
    .from('workflow_runs')
    .select('id')
    .eq('chapter_id', chapterId)
    .eq('kind', CHAPTER_AUDIT)
    .neq('id', run.id)
    .returns<{ id: string }[]>();

  if (letturaPrecedentiError) {
    await admin.from('workflow_runs').delete().eq('id', run.id);
    return { ok: false, message: 'Impossibile preparare la sostituzione degli audit precedenti.' };
  }

  const idsPrecedenti = (precedenti ?? []).map((voce) => voce.id);
  if (idsPrecedenti.length > 0) {
    // review_requests usa ON DELETE SET NULL: va rimossa esplicitamente,
    // altrimenti la vecchia revisione resterebbe visibile ma senza audit.
    const { error: reviewError } = await admin
      .from('review_requests')
      .delete()
      .in('workflow_run_id', idsPrecedenti);
    const { error: runsError } = reviewError
      ? { error: reviewError }
      : await admin.from('workflow_runs').delete().in('id', idsPrecedenti);

    if (runsError) {
      await admin.from('workflow_runs').delete().eq('id', run.id);
      return { ok: false, message: 'Pulizia degli audit precedenti non riuscita. Nessun nuovo audit è stato avviato.' };
    }
  }

  try {
    const started = await start(chapterAuditWorkflow, [
      {
        workflowRunId: run.id,
        organizationId: organization.id,
        projectId: chapter.project_id,
        chapterId,
        actorId: user.id,
        resumeToken,
        globalSequence,
      },
    ]);

    // L'identificativo del motore permette di ritrovare l'esecuzione
    // nell'osservabilità di Vercel.
    await admin
      .from('workflow_runs')
      .update({ external_run_id: started.runId ?? null })
      .eq('id', run.id);
  } catch (caught) {
    await admin
      .from('workflow_runs')
      .update({
        status: 'failed',
        error: { message: caught instanceof Error ? caught.message : String(caught) },
        finished_at: new Date().toISOString(),
      })
      .eq('id', run.id);

    return { ok: false, message: 'Avvio del workflow non riuscito.', workflowRunId: run.id };
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'workflow.started',
    entityType: 'workflow_run',
    entityId: run.id,
    metadata: { kind: CHAPTER_AUDIT, chapterId, removedPreviousRuns: idsPrecedenti.length },
  });

  revalidatePath(`/projects/${chapter.project_id}/workflows`);
  return { ok: true, message: 'Audit avviato.', workflowRunId: run.id };
}

/** Avvia la coda globale: un solo capitolo, il successivo parte dopo l'approvazione. */
export async function startProjectAudit(projectId: string): Promise<CommandResult> {
  await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();
  const { data: active } = await supabase.from('workflow_runs').select('id')
    .eq('project_id', projectId).in('status', ['queued', 'running', 'awaiting_approval']).limit(1);
  if ((active?.length ?? 0) > 0) {
    return { ok: false, message: 'Termina o revisiona il capitolo già in corso prima di avviare la sequenza.' };
  }
  const { data: chapters, error } = await supabase.from('chapters')
    .select('id, organization_id').eq('project_id', projectId).eq('status', 'draft')
    .order('order_index').returns<{ id: string; organization_id: string }[]>();
  if (error) return { ok: false, message: `Lettura dei capitoli fallita: ${error.message}` };
  const authorized = (chapters ?? []).filter((chapter) => chapter.organization_id === organization.id);
  if (authorized.length === 0) return { ok: false, message: 'Non ci sono capitoli in bozza da elaborare.' };

  const result = await startChapterAudit(authorized[0]!.id, true);
  revalidatePath(`/projects/${projectId}/structure`);
  revalidatePath(`/projects/${projectId}/workflows`);
  return {
    ok: result.ok,
    workflowRunId: result.workflowRunId,
    message: result.ok
      ? `Sequenza avviata dal primo di ${authorized.length} capitoli. Il successivo partirà soltanto dopo l’approvazione del corrente.`
      : result.message,
  };
}

/**
 * Richiesta di annullamento.
 *
 * Il motore non interrompe uno step a metà: l'annullamento è cooperativo.
 * Il run viene marcato e non prosegue oltre il gate di approvazione.
 */
export async function cancelWorkflow(workflowRunId: string): Promise<CommandResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: run } = await supabase
    .from('workflow_runs')
    .select('id, status, project_id, organization_id')
    .eq('id', workflowRunId)
    .maybeSingle<{ id: string; status: string; project_id: string; organization_id: string }>();

  if (!run || run.organization_id !== organization.id) {
    return { ok: false, message: 'Esecuzione non trovata.' };
  }

  if (['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(run.status)) {
    return { ok: false, message: 'L’esecuzione è già terminata.' };
  }

  await supabase
    .from('workflow_runs')
    .update({
      cancel_requested: true,
      status: 'cancelled',
      finished_at: new Date().toISOString(),
    })
    .eq('id', workflowRunId);

  await supabase
    .from('review_requests')
    .update({ status: 'rejected', decided_at: new Date().toISOString(), decided_by: user.id, decision_note: 'Esecuzione annullata.' })
    .eq('workflow_run_id', workflowRunId)
    .eq('status', 'pending');

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'workflow.cancelled',
    entityType: 'workflow_run',
    entityId: workflowRunId,
  });

  revalidatePath(`/projects/${run.project_id}/workflows`);
  return { ok: true, message: 'Esecuzione annullata.' };
}

/** Ritenta un audit fallito o annullato, avviandone uno nuovo sullo stesso capitolo. */
export async function retryWorkflow(workflowRunId: string): Promise<CommandResult> {
  await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: run } = await supabase
    .from('workflow_runs')
    .select('id, status, chapter_id, organization_id, attempt')
    .eq('id', workflowRunId)
    .maybeSingle<{
      id: string; status: string; chapter_id: string | null; organization_id: string; attempt: number;
    }>();

  if (!run || run.organization_id !== organization.id || !run.chapter_id) {
    return { ok: false, message: 'Esecuzione non trovata.' };
  }

  if (!['failed', 'cancelled'].includes(run.status)) {
    return { ok: false, message: 'Si può ritentare solo un’esecuzione fallita o annullata.' };
  }

  return startChapterAudit(run.chapter_id);
}

/**
 * Decisione umana sulla revisione proposta.
 * È l'unico punto da cui il workflow può riprendere.
 */
export async function decideReview(
  reviewRequestId: string,
  decision: 'approved' | 'rejected' | 'changes_requested',
  note: string | null,
): Promise<CommandResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: request } = await supabase
    .from('review_requests')
    .select('id, status, resume_token, project_id, chapter_id, organization_id, workflow_run_id')
    .eq('id', reviewRequestId)
    .maybeSingle<{
      id: string; status: string; resume_token: string | null;
      project_id: string; chapter_id: string; organization_id: string; workflow_run_id: string | null;
    }>();

  if (!request || request.organization_id !== organization.id) {
    return { ok: false, message: 'Richiesta di revisione non trovata.' };
  }

  if (request.status !== 'pending') {
    return { ok: false, message: 'La revisione è già stata decisa.' };
  }

  if (!request.resume_token) {
    return { ok: false, message: 'Token di ripresa mancante: il workflow non può essere ripreso.' };
  }


  // Il motore dei workflow è l'unica strada normale, ma non è l'unica possibile.
  // Se l'esecuzione non è più sospesa — è fallita, è stata annullata, oppure il
  // processo è ripartito perdendo i gate in attesa — il hook non esiste più e
  // la ripresa fallisce con «Hook not found».
  //
  // Quel guasto non deve però annullare una decisione già presa da una persona:
  // il workflow è un modo di applicare la decisione, non la decisione stessa.
  // Si applica direttamente ciò che avrebbe fatto lui, e lo si dichiara.
  let ripresa = true;
  try {
    await approvalHook.resume(request.resume_token, {
      decision,
      note: note ?? undefined,
      decidedBy: user.id,
    });
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    if (!/hook not found/i.test(motivo)) throw error;

    ripresa = false;
    const applicata = await applicaDecisioneSenzaWorkflow(
      reviewRequestId,
      decision,
      note,
      user.id,
      organization.id,
    );
    if (!applicata.ok) return applicata;

    // L'esecuzione resterebbe «in attesa di approvazione» per sempre, mentre la
    // decisione è stata presa: la cronologia direbbe il falso.
    if (request.workflow_run_id) {
      await supabase
        .from('workflow_runs')
        .update({
          status: 'completed_with_warnings',
          finished_at: new Date().toISOString(),
          error: {
            message:
              'Esecuzione non più sospesa al momento della decisione: la decisione è stata ' +
              'applicata direttamente ai dati. Anteprima del volume da ricomporre.',
          },
        })
        .eq('id', request.workflow_run_id);
    }
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: `review.${decision}`,
    entityType: 'review_request',
    entityId: reviewRequestId,
    metadata: { workflowRunId: request.workflow_run_id },
  });


  revalidatePath(`/projects/${request.project_id}/reviews`);
  revalidatePath(`/projects/${request.project_id}/workflows`);

  const base =
    decision === 'approved'
      ? 'Revisione approvata: la nuova versione diventa quella corrente.'
      : 'Decisione registrata.';

  return {
    ok: true,
    message: ripresa
      ? base
      : `${base} L’esecuzione non era più sospesa: la decisione è stata applicata direttamente, ` +
        'e l’anteprima del volume va ricomposta dalla scheda Anteprima.',
  };
}

/**
 * Applica la decisione quando il workflow non è più sospeso.
 *
 * Riproduce ciò che avrebbe fatto il passaggio `applyDecision`: chiude la
 * richiesta di revisione, promuove la versione proposta e aggiorna lo stato del
 * capitolo. Non è una scorciatoia — è il ripristino di una decisione umana già
 * presa, che non deve andare persa perché il motore ha perso il proprio stato.
 *
 * Quello che **non** fa, e per cui l'interfaccia avvisa: ricomporre l'anteprima
 * del volume. Farlo qui significherebbe generare un PDF dentro l'azione che
 * risponde al click, con l'attesa che ne consegue; è un'operazione che ha già
 * il suo pulsante nella scheda Anteprima.
 */
async function applicaDecisioneSenzaWorkflow(
  reviewRequestId: string,
  decision: 'approved' | 'rejected' | 'changes_requested',
  note: string | null,
  decidedBy: string,
  organizationId: string,
): Promise<CommandResult> {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data: request } = await supabase
    .from('review_requests')
    .select('id, project_id, chapter_id, proposed_version_id, organization_id')
    .eq('id', reviewRequestId)
    .maybeSingle<{
      id: string; project_id: string; chapter_id: string; proposed_version_id: string | null; organization_id: string;
    }>();

  if (!request || request.organization_id !== organizationId) {
    return { ok: false, message: 'Richiesta di revisione non trovata.' };
  }

  const { error } = await supabase
    .from('review_requests')
    .update({ status: decision, decided_at: now, decided_by: decidedBy, decision_note: note })
    .eq('id', reviewRequestId);

  if (error) return { ok: false, message: `Decisione non registrata: ${error.message}` };

  if (decision !== 'approved' || !request.proposed_version_id) {
    await supabase.from('chapters').update({ status: 'draft' }).eq('id', request.chapter_id);
    return { ok: true, message: 'Decisione registrata.' };
  }

  await supabase
    .from('chapter_versions')
    .update({ origin: 'approved', is_approved: true, approved_by: decidedBy, approved_at: now })
    .eq('id', request.proposed_version_id);

  await supabase
    .from('chapters')
    .update({ current_version_id: request.proposed_version_id, status: 'approved' })
    .eq('id', request.chapter_id);

  await rebuildVolumePreviewWith(createAdminClient(), {
    projectId: request.project_id,
    organizationId,
    actorId: decidedBy,
  });

  return { ok: true, message: 'Decisione applicata.' };
}
