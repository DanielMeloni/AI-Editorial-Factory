import type { z } from 'zod';
import { ProviderError, type TextProvider, type TextRequest, type TextResult } from '../types';

/**
 * Provider testuale mock.
 *
 * Non contatta alcun servizio e non consuma crediti. Non inventa contenuti:
 * quando un agente ha un'implementazione deterministica, è quest'ultima a
 * produrre l'output e il provider non viene nemmeno interpellato (vedi
 * `runAgent`). Questo provider serve ai casi residui e ai test, dove restituisce
 * un valore minimo conforme allo schema.
 *
 * Se lo schema non ammette un valore minimo costruibile, fallisce in modo
 * esplicito invece di restituire dati verosimili ma falsi.
 */
export class MockTextProvider implements TextProvider {
  readonly name = 'mock';

  constructor(readonly model: string = 'mock-text-1') {}

  async generateStructured<T>(request: TextRequest, schema: z.ZodType<T>): Promise<TextResult<T>> {
    const parsed = schema.safeParse(undefined);

    if (!parsed.success) {
      throw new ProviderError(
        'Il provider mock non ha un’implementazione deterministica per questa richiesta. ' +
          'Definisci `mock()` sull’agente oppure configura un provider reale.',
        false,
        this.name,
      );
    }

    return {
      provider: this.name,
      model: this.model,
      data: parsed.data,
      raw: '',
      usage: { inputTokens: estimateTokens(request.system + request.prompt), outputTokens: 0 },
      estimatedCostUsd: 0,
      warnings: ['Output prodotto dal provider mock: nessun modello è stato interpellato.'],
    };
  }
}

/** Stima grossolana: circa 4 caratteri per token. Serve solo alla contabilità. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
