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

export async function startChapterAudit(chapterId: string): Promise<CommandResult> {
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
      input: { chapterTitle: chapter.title, resumeToken },
      started_by: user.id,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !run) {
    return { ok: false, message: 'Registrazione del workflow non riuscita.' };
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
      },
    ]);

    // L'identificativo del motore permette di ritrovare l'esecuzione
    // nell'osservabilità di Vercel.
    await createAdminClient()
      .from('workflow_runs')
      .update({ external_run_id: started.runId ?? null })
      .eq('id', run.id);
  } catch (caught) {
    await createAdminClient()
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
    metadata: { kind: CHAPTER_AUDIT, chapterId },
  });

  revalidatePath(`/projects/${chapter.project_id}/workflows`);
  return { ok: true, message: 'Audit avviato.', workflowRunId: run.id };
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
    .select('id, status, resume_token, project_id, organization_id, workflow_run_id')
    .eq('id', reviewRequestId)
    .maybeSingle<{
      id: string; status: string; resume_token: string | null;
      project_id: string; organization_id: string; workflow_run_id: string | null;
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

  await approvalHook.resume(request.resume_token, {
    decision,
    note: note ?? undefined,
    decidedBy: user.id,
  });

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

  return {
    ok: true,
    message:
      decision === 'approved'
        ? 'Revisione approvata: la nuova versione diventa quella corrente.'
        : 'Decisione registrata.',
  };
}
