import { ProviderError } from '../types';
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from './types';

/** Ricerca con failover fra fornitori indipendenti. */
export class RoutedWebSearchProvider implements WebSearchProvider {
  readonly name: string;
  readonly model: string;

  constructor(private readonly providers: WebSearchProvider[]) {
    if (providers.length === 0) throw new Error('La catena di ricerca non può essere vuota.');
    this.name = providers[0]!.name;
    this.model = providers[0]!.model;
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const failures: string[] = [];

    for (const [index, provider] of this.providers.entries()) {
      try {
        const result = await provider.search(request);
        return index === 0
          ? result
          : {
              ...result,
              warnings: [`Fallback ricerca attivato: ${failures.join(' | ')}`, ...result.warnings],
            };
      } catch (error) {
        const recoverable =
          error instanceof ProviderError &&
          (error.retryable || [400, 404, 429].includes(error.statusCode ?? 0));
        if (!recoverable || index === this.providers.length - 1) throw error;
        failures.push(`${provider.name}:${provider.model} — ${error.message}`);
      }
    }

    throw new ProviderError('Nessun motore di ricerca disponibile.', false, this.name);
  }
}
