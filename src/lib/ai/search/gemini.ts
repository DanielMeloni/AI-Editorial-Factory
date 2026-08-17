import { ProviderError } from '../types';
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchHit } from './types';

/**
 * Ricerca web tramite il grounding con Google Search di Gemini.
 *
 * È l'unico dei tre motori che cerca **senza richiedere un conto attivo**:
 * Per le nuove utenze i modelli 2.5 non sono più disponibili. Il modello
 * corrente supporta Google Search, ma richiede un progetto con billing attivo.
 *
 * Vale la stessa divisione degli altri adapter: qui si raccolgono soltanto gli
 * indirizzi. La prosa che il modello scrive attorno viene ignorata — non serve
 * un riassunto di seconda mano, servono le fonti, che verranno aperte una per
 * una prima di essere mostrate.
 */

/** Modello corrente per Interactions API + Google Search. */
export const DEFAULT_GEMINI_SEARCH_MODEL = 'gemini-3.6-flash';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** Estrae il motivo reale di un errore, invece di riferire solo il codice. */
export function describeGeminiError(status: number, body: string): string {
  let dettaglio = '';

  try {
    const payload = JSON.parse(body) as { error?: { message?: string; status?: string } };
    dettaglio = payload.error?.message ?? '';
  } catch {
    dettaglio = body.slice(0, 300);
  }

  const base = `Gemini ha risposto ${status}`;
  if (!dettaglio) return `${base}.`;

  if (status === 429 || /quota|rate limit/i.test(dettaglio)) {
    return (
      `${base}: quota o limite di frequenza esaurito per il modello configurato. ` +
      `Per le nuove utenze, Gemini con Google Search richiede billing attivo; ` +
      `in alternativa configura AI_SEARCH_PROVIDER=openai o anthropic con la relativa chiave. ` +
      `Messaggio del fornitore: ${dettaglio}`
    );
  }

  if (status === 403 || /permission|api key not valid|denied/i.test(dettaglio)) {
    return (
      `${base}: chiave rifiutata. Controlla GEMINI_API_KEY e che l'API Generative Language ` +
      `sia abilitata sul progetto. Messaggio del fornitore: ${dettaglio}`
    );
  }

  if (/billing|paid/i.test(dettaglio)) {
    return (
      `${base}: questo modello richiede un conto con fatturazione attiva per il grounding. ` +
      `Prova con «${DEFAULT_GEMINI_SEARCH_MODEL}» e verifica il piano del progetto. ` +
      `Messaggio del fornitore: ${dettaglio}`
    );
  }

  if (/model/i.test(dettaglio)) {
    if (/no longer available to new users/i.test(dettaglio)) {
      return (
        `${base}: il modello configurato non è disponibile per le nuove utenze. ` +
        `Usa AI_SEARCH_MODEL=«${DEFAULT_GEMINI_SEARCH_MODEL}» con billing Gemini attivo, ` +
        `oppure configura un altro AI_SEARCH_PROVIDER. Messaggio del fornitore: ${dettaglio}`
      );
    }
    return (
      `${base}: modello non valido o senza grounding. Controlla AI_SEARCH_MODEL. ` +
      `Messaggio del fornitore: ${dettaglio}`
    );
  }

  return `${base}: ${dettaglio}`;
}

/**
 * Raccoglie gli indirizzi da una risposta di Gemini.
 *
 * La forma della risposta è cambiata nel tempo: le versioni recenti usano
 * `annotations` di tipo `url_citation`, quelle precedenti `groundingMetadata`
 * con `groundingChunks`. Si leggono entrambe — costa poche righe e evita che
 * un aggiornamento dell'API renda muto il motore senza che nessuno se ne
 * accorga, che è il modo peggiore di rompersi.
 */
export function extractGeminiUrls(payload: unknown, max: number): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const visti = new Set<string>();

  const aggiungi = (url: unknown, title: unknown) => {
    if (typeof url !== 'string' || url.length === 0) return;
    if (visti.has(url) || hits.length >= max) return;
    visti.add(url);
    hits.push({
      url,
      title: typeof title === 'string' ? title.slice(0, 300) : '',
      snippet: '',
    });
  };

  // Percorso ricorsivo: la struttura è annidata e cambia fra le versioni, ma
  // le foglie che interessano hanno sempre gli stessi nomi.
  const visita = (nodo: unknown, profondita: number) => {
    if (profondita > 8 || nodo === null || typeof nodo !== 'object') return;

    if (Array.isArray(nodo)) {
      for (const voce of nodo) visita(voce, profondita + 1);
      return;
    }

    const oggetto = nodo as Record<string, unknown>;

    if (oggetto.type === 'url_citation') aggiungi(oggetto.url, oggetto.title);

    // groundingChunks: [{ web: { uri, title } }]
    const web = oggetto.web as Record<string, unknown> | undefined;
    if (web && typeof web === 'object') aggiungi(web.uri ?? web.url, web.title);

    for (const valore of Object.values(oggetto)) visita(valore, profondita + 1);
  };

  visita(payload, 0);
  return hits;
}

export class GeminiWebSearchProvider implements WebSearchProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const maxResults = Math.min(request.maxResults ?? 10, 20);

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          input:
            'Cerca fonti di riferimento per un manuale tecnico e cita le pagine consultate. ' +
            `Argomento: ${request.query}`,
          tools: [{ type: 'google_search' }],
        }),
      });
    } catch (error) {
      throw new ProviderError('Rete non raggiungibile.', true, this.name, error);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const body = await response.text().catch(() => '');
      throw new ProviderError(
        describeGeminiError(response.status, body),
        retryable,
        this.name,
        undefined,
        response.status,
      );
    }

    const payload = (await response.json()) as {
      usage?: { input_tokens?: number; output_tokens?: number };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const hits = extractGeminiUrls(payload, maxResults);

    return {
      provider: this.name,
      model: this.model,
      hits,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? payload.usageMetadata?.promptTokenCount ?? 0,
        outputTokens:
          payload.usage?.output_tokens ?? payload.usageMetadata?.candidatesTokenCount ?? 0,
      },
      // Una richiesta di grounding conta come una, indipendentemente da quante
      // interrogazioni il modello esegua al suo interno.
      searches: 1,
      // Entro la quota gratuita giornaliera il costo è nullo. Superata, il
      // conteggio lo tiene Google: non viene stimato qui per non dichiarare un
      // importo che non è stato verificato.
      estimatedCostUsd: 0,
      warnings:
        hits.length === 0
          ? ['La ricerca non ha prodotto risultati per questa interrogazione.']
          : [],
    };
  }
}
