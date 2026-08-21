import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Limiti sulle operazioni AI.
 *
 * Il conteggio non usa una tabella dedicata né la memoria del processo: legge
 * le righe che l'operazione stessa produce. Due conseguenze utili:
 *
 *  - il limite regge su più istanze serverless, che non condividono memoria;
 *  - non esiste un contatore che possa divergere dai fatti.
 *
 * I limiti sono per organizzazione, non per utente: è l'organizzazione a pagare
 * il consumo.
 */

export interface RateLimit {
  /** Numero massimo di operazioni nella finestra. */
  max: number;
  /** Ampiezza della finestra, in minuti. */
  windowMinutes: number;
}

export const RATE_LIMITS = {
  /**
   * Avvii di workflow. Un audit globale crea un'esecuzione per capitolo: il
   * limite deve contenere almeno un manuale tecnico completo, non troncarlo al
   * ventesimo capitolo. Resta abbastanza basso da fermare cicli accidentali.
   */
  workflowStart: { max: 100, windowMinutes: 60 },
  /** Generazione di immagini: è l'operazione più costosa. */
  imageGeneration: { max: 40, windowMinutes: 60 },
  /** Esportazioni: leggere per l'AI, pesanti per lo storage. */
  exportRun: { max: 60, windowMinutes: 60 },
} as const satisfies Record<string, RateLimit>;

export type RateLimitKind = keyof typeof RATE_LIMITS;

export type RateLimitVerdict =
  | { allowed: true; remaining: number }
  | { allowed: false; used: number; max: number; retryAfterMinutes: number; message: string };

const SORGENTE: Record<RateLimitKind, { table: string; column: string }> = {
  workflowStart: { table: 'workflow_runs', column: 'created_at' },
  imageGeneration: { table: 'visual_assets', column: 'created_at' },
  exportRun: { table: 'exports', column: 'requested_at' },
};

export async function checkRateLimit(
  supabase: SupabaseClient,
  kind: RateLimitKind,
  organizationId: string,
  extraFilter?: { column: string; value: string },
): Promise<RateLimitVerdict> {
  const limite = RATE_LIMITS[kind];
  const sorgente = SORGENTE[kind];
  const inizio = new Date(Date.now() - limite.windowMinutes * 60_000).toISOString();

  let query = supabase
    .from(sorgente.table)
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .gte(sorgente.column, inizio);

  if (extraFilter) query = query.eq(extraFilter.column, extraFilter.value);

  const { count, error } = await query;

  // In caso di errore di lettura si lascia passare: un limite che blocca per un
  // guasto proprio è peggiore del rischio che dovrebbe prevenire.
  if (error) {
    console.warn(`Verifica del limite «${kind}» non riuscita:`, error.message);
    return { allowed: true, remaining: limite.max };
  }

  const usate = count ?? 0;

  if (usate >= limite.max) {
    return {
      allowed: false,
      used: usate,
      max: limite.max,
      retryAfterMinutes: limite.windowMinutes,
      message:
        `Limite raggiunto: ${limite.max} operazioni ogni ${limite.windowMinutes} minuti ` +
        'per organizzazione. Riprova più tardi.',
    };
  }

  return { allowed: true, remaining: limite.max - usate };
}
