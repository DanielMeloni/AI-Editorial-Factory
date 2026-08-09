import { describe, expect, it, vi } from 'vitest';
import { RATE_LIMITS, checkRateLimit } from '@/lib/security/rate-limit';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Client minimo che restituisce un conteggio prestabilito. */
function clientCon(count: number | null, error?: { message: string }): SupabaseClient {
  const query = {
    select: () => query,
    eq: () => query,
    gte: () => Promise.resolve({ count, error: error ?? null }),
  };
  return { from: () => query } as unknown as SupabaseClient;
}

const ORG = '11111111-2222-3333-4444-555555555555';

describe('limiti sulle operazioni AI', () => {
  it('definisce un limite e una finestra per ogni tipo', () => {
    for (const [nome, limite] of Object.entries(RATE_LIMITS)) {
      expect(limite.max, nome).toBeGreaterThan(0);
      expect(limite.windowMinutes, nome).toBeGreaterThan(0);
    }
  });

  it('consente l’operazione sotto la soglia e riporta il residuo', async () => {
    const esito = await checkRateLimit(clientCon(5), 'workflowStart', ORG);
    expect(esito.allowed).toBe(true);
    if (esito.allowed) {
      expect(esito.remaining).toBe(RATE_LIMITS.workflowStart.max - 5);
    }
  });

  it('blocca al raggiungimento della soglia', async () => {
    const esito = await checkRateLimit(
      clientCon(RATE_LIMITS.imageGeneration.max),
      'imageGeneration',
      ORG,
    );

    expect(esito.allowed).toBe(false);
    if (!esito.allowed) {
      expect(esito.used).toBe(RATE_LIMITS.imageGeneration.max);
      expect(esito.retryAfterMinutes).toBe(RATE_LIMITS.imageGeneration.windowMinutes);
      expect(esito.message).toMatch(/Limite raggiunto/);
    }
  });

  it('blocca anche oltre la soglia', async () => {
    const esito = await checkRateLimit(clientCon(999), 'exportRun', ORG);
    expect(esito.allowed).toBe(false);
  });

  /**
   * Un limite che blocca a causa di un proprio guasto è peggiore del rischio
   * che dovrebbe prevenire: qui si lascia passare e si annota nei log.
   */
  it('lascia passare se la verifica stessa fallisce', async () => {
    const avviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const esito = await checkRateLimit(clientCon(null, { message: 'guasto' }), 'workflowStart', ORG);

    expect(esito.allowed).toBe(true);
    expect(avviso).toHaveBeenCalled();
    avviso.mockRestore();
  });

  it('tratta l’assenza di righe come zero operazioni', async () => {
    const esito = await checkRateLimit(clientCon(0), 'workflowStart', ORG);
    expect(esito.allowed).toBe(true);
    if (esito.allowed) expect(esito.remaining).toBe(RATE_LIMITS.workflowStart.max);
  });
});
