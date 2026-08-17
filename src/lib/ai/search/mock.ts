import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from './types';

/**
 * Motore di ricerca simulato.
 *
 * Non restituisce nulla, e lo dichiara. La tentazione sarebbe generare qualche
 * risultato verosimile per far vedere l'interfaccia popolata, ma sarebbe
 * esattamente il comportamento che questo progetto rifiuta: un elenco di fonti
 * inventate è peggio di un elenco vuoto, perché sembra un risultato.
 *
 * Chi sviluppa senza chiave vede quindi un elenco vuoto e un avviso che spiega
 * come attivarlo. Tutto il resto del flusso — verifica, selezione, biblioteca —
 * resta percorribile con le fonti aggiunte a mano.
 */
export class MockWebSearchProvider implements WebSearchProvider {
  readonly name = 'mock';

  constructor(readonly model = 'mock-search-1') {}

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    return {
      provider: this.name,
      model: this.model,
      hits: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      searches: 0,
      estimatedCostUsd: 0,
      warnings: [
        `Ricerca web non attiva: «${request.query.slice(0, 80)}» non è stata cercata. ` +
          'Imposta AI_SEARCH_PROVIDER=anthropic con la relativa chiave per cercare davvero. ' +
          'Il provider simulato non inventa risultati.',
      ],
    };
  }
}
