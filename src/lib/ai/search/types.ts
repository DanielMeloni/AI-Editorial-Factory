/**
 * Interfaccia comune ai motori di ricerca web.
 *
 * Il dominio non importa mai un SDK: parla soltanto con `WebSearchProvider`.
 * Cambiare motore — o non averne uno — non richiede di toccare la ricerca
 * delle fonti.
 *
 * Un risultato di ricerca è **grezzo e non verificato**: è ciò che un motore
 * dichiara di aver trovato. Prima di finire sotto gli occhi di qualcuno passa
 * per `verifyUrl`, che apre davvero l'indirizzo. Questa separazione è
 * deliberata: il provider riferisce, la verifica giudica.
 */

export interface WebSearchRequest {
  query: string;
  /** Numero massimo di risultati desiderati. Il motore può restituirne meno. */
  maxResults?: number;
  /** Limita la ricerca a questi domini, quando il motore lo consente. */
  allowedDomains?: string[];
}

export interface WebSearchHit {
  url: string;
  /** Titolo dichiarato dal motore. Non è ancora quello vero: lo dirà la pagina. */
  title: string;
  snippet: string;
}

export interface WebSearchResult {
  provider: string;
  model: string;
  hits: WebSearchHit[];
  usage: { inputTokens: number; outputTokens: number };
  /** Numero di ricerche effettivamente eseguite: è ciò che il fornitore fattura. */
  searches: number;
  estimatedCostUsd: number;
  warnings: string[];
}

export interface WebSearchProvider {
  readonly name: string;
  readonly model: string;
  search(request: WebSearchRequest): Promise<WebSearchResult>;
}
