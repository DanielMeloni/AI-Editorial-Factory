import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { ProviderError } from '@/lib/ai/types';
import { getTextProvider } from '@/lib/ai/registry';
import type { AgentDefinition } from './definitions';

/**
 * Esecuzione tracciata di un agente.
 *
 * Ogni invocazione lascia una riga in `agent_runs` con tutto ciò che serve a
 * riprodurla e a contabilizzarla: agente, versione del prompt, provider,
 * modello, hash dell'input, durata, esito, token, costo stimato, avvisi,
 * livello di confidenza, errore, tentativo e workflow di appartenenza.
 *
 * Input e output sono validati con Zod ai due estremi. Un output non conforme
 * è un errore di esecuzione, non un risultato da interpretare a valle.
 */

export interface AgentContext {
  /** Client con service role: gli step girano senza sessione utente. */
  db: SupabaseClient;
  organizationId: string;
  projectId: string;
  chapterId: string | null;
  workflowRunId: string | null;
  stepName: string;
  /** Numero di tentativo, per distinguere le riesecuzioni. */
  attempt?: number;
}

export interface AgentRunResult<O> {
  output: O;
  agentRunId: string | null;
  provider: string;
  model: string;
  usedModel: boolean;
  warnings: string[];
  estimatedCostUsd: number;
}

/** Hash stabile dell'input: chiavi ordinate, così lo stesso contenuto dà lo stesso hash. */
export async function hashInput(value: unknown): Promise<string> {
  const canonical = JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  });

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical ?? ''));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function runAgent<I, O>(
  agent: AgentDefinition<I, O>,
  rawInput: I,
  context: AgentContext,
): Promise<AgentRunResult<O>> {
  const startedAt = Date.now();
  const attempt = context.attempt ?? 1;

  // ---------------------------------------------------------------------
  // Validazione dell'input
  // ---------------------------------------------------------------------
  const parsedInput = agent.inputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new Error(
      `Input non valido per l’agente ${agent.key}: ` +
        parsedInput.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
    );
  }
  const input = parsedInput.data;
  const inputHash = await hashInput(input);

  const { provider, degraded } = getTextProvider(agent.key);
  const warnings: string[] = degraded ? [degraded] : [];

  // In modalità mock l'implementazione deterministica è quella preferita:
  // produce un risultato reale invece di un testo verosimile.
  const useDeterministic = provider.name === 'mock' && agent.deterministic !== undefined;

  // ---------------------------------------------------------------------
  // Riga di esecuzione, aperta prima di iniziare
  // ---------------------------------------------------------------------
  const { data: runRow } = await context.db
    .from('agent_runs')
    .insert({
      workflow_run_id: context.workflowRunId,
      project_id: context.projectId,
      organization_id: context.organizationId,
      chapter_id: context.chapterId,
      agent_key: agent.key,
      agent_version: agent.version,
      prompt_version: agent.promptVersion,
      provider: useDeterministic ? 'deterministic' : provider.name,
      model: useDeterministic ? `${agent.key}@${agent.version}` : provider.model,
      step_name: context.stepName,
      input_hash: inputHash,
      input: input as unknown as Record<string, unknown>,
      status: 'running',
      attempt,
    })
    .select('id')
    .single<{ id: string }>();

  const agentRunId = runRow?.id ?? null;

  try {
    let output: O;
    let inputTokens = 0;
    let outputTokens = 0;
    let estimatedCostUsd = 0;
    let effectiveProvider = provider.name;
    let effectiveModel = provider.model;

    if (useDeterministic) {
      output = agent.deterministic!(input);
    } else {
      const result = await provider.generateStructured(
        {
          system: agent.system,
          prompt: agent.buildPrompt(input),
          temperature: 0.2,
          maxOutputTokens: agent.maxOutputTokens,
        },
        agent.outputSchema,
      );
      output = result.data;
      inputTokens = result.usage.inputTokens;
      outputTokens = result.usage.outputTokens;
      estimatedCostUsd = result.estimatedCostUsd;
      effectiveProvider = result.provider;
      effectiveModel = result.model;
      warnings.push(...result.warnings);
    }

    // Validazione dell'output anche sul percorso deterministico: un'implementazione
    // che sfora il proprio contratto è un errore, non un caso da tollerare.
    const parsedOutput = agent.outputSchema.safeParse(output);
    if (!parsedOutput.success) {
      throw new Error(
        `Output non conforme per l’agente ${agent.key}: ` +
          parsedOutput.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
      );
    }

    const durationMs = Date.now() - startedAt;
    const confidence =
      typeof (parsedOutput.data as { confidence?: unknown }).confidence === 'number'
        ? (parsedOutput.data as { confidence: number }).confidence
        : null;

    if (agentRunId) {
      await context.db
        .from('agent_runs')
        .update({
          output: parsedOutput.data as unknown as Record<string, unknown>,
          status: warnings.length > 0 ? 'completed_with_warnings' : 'completed',
          warnings,
          confidence,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: estimatedCostUsd,
          provider: useDeterministic ? 'deterministic' : effectiveProvider,
          model: useDeterministic ? `${agent.key}@${agent.version}` : effectiveModel,
          duration_ms: durationMs,
          finished_at: new Date().toISOString(),
        })
        .eq('id', agentRunId);

      // Il consumo viene registrato anche quando è nullo: serve a distinguere
      // «non ha speso» da «non è stato eseguito».
      await context.db.from('usage_events').insert({
        organization_id: context.organizationId,
        project_id: context.projectId,
        agent_run_id: agentRunId,
        provider: useDeterministic ? 'deterministic' : effectiveProvider,
        model: useDeterministic ? `${agent.key}@${agent.version}` : effectiveModel,
        kind: 'text',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: estimatedCostUsd,
      });
    }

    return {
      output: parsedOutput.data,
      agentRunId,
      provider: useDeterministic ? 'deterministic' : effectiveProvider,
      model: useDeterministic ? `${agent.key}@${agent.version}` : effectiveModel,
      usedModel: !useDeterministic,
      warnings,
      estimatedCostUsd,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = error instanceof ProviderError ? error.retryable : false;

    if (agentRunId) {
      await context.db
        .from('agent_runs')
        .update({
          status: 'failed',
          error: { message, retryable },
          duration_ms: Date.now() - startedAt,
          finished_at: new Date().toISOString(),
        })
        .eq('id', agentRunId);
    }

    throw error;
  }
}
