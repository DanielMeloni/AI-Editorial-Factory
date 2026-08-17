import type { z } from 'zod';
import { ProviderError, type TextProvider, type TextRequest, type TextResult } from '../types';

/** Prova provider alternativi soltanto dopo un errore tecnico recuperabile. */
export class RoutedTextProvider implements TextProvider {
  readonly name: string;
  readonly model: string;

  constructor(private readonly providers: TextProvider[]) {
    if (providers.length === 0) throw new Error('La catena dei provider non può essere vuota.');
    this.name = providers[0]!.name;
    this.model = providers[0]!.model;
  }

  async generateStructured<T>(request: TextRequest, schema: z.ZodType<T>): Promise<TextResult<T>> {
    const failures: string[] = [];

    for (const [index, provider] of this.providers.entries()) {
      try {
        const result = await provider.generateStructured(request, schema);
        return index === 0
          ? result
          : {
              ...result,
              warnings: [
                `Fallback attivato: ${failures.join(' | ')}`,
                ...result.warnings,
              ],
            };
      } catch (error) {
        const canFallback =
          error instanceof ProviderError &&
          (error.retryable || error.statusCode === 404 || error.statusCode === 429);
        if (!canFallback || index === this.providers.length - 1) throw error;
        failures.push(`${provider.name}:${provider.model} — ${error.message}`);
      }
    }

    throw new ProviderError('Nessun provider disponibile.', false, this.name);
  }
}
