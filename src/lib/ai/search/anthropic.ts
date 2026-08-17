import { ProviderError } from '../types';
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchHit } from './types';

/**
 * Ricerca web tramite lo strumento nativo di Anthropic.
 *
 * Il modello esegue la ricerca lato server e restituisce, nei blocchi
 * `web_search_tool_result`, gli indirizzi trovati. Qui interessano soltanto
 * quelli: la valutazione di che cosa sia utile avviene dopo, con un agente che
 * ha un contratto Zod, e la verifica che gli indirizzi esistano davvero avviene
 * prima ancora — aprendoli.
 *
 * Non si chiede al modello di riassumere né di giudicare in questa chiamata:
 * fare due cose in una risposta significa non poterne validare nessuna.
 */

/** Costo dichiarato dello strumento: dollari per mille ricerche. */
const COST_PER_THOUSAND_SEARCHES = 10;

/** Versione dello strumento. Le precedenti restano accettate dall'API. */
const TOOL_TYPE = 'web_search_20260318';

interface SearchResultBlock {
  type: string;
  url?: string;
  title?: string;
}

interface ContentBlock {
  type: string;
  content?: SearchResultBlock[] | string;
}

/**
 * Estrae il motivo reale di un errore dell'API.
 *
 * Senza questo, un 400 diventa «Anthropic ha risposto 400»: un messaggio che
 * non permette di distinguere una chiave sbagliata da uno strumento non
 * abilitato, e costringe a indovinare. Il fornitore il motivo lo scrive
 * sempre; il compito è riportarlo.
 */
export function describeApiError(status: number, body: string): string {
  let dettaglio = '';

  try {
    const payload = JSON.parse(body) as { error?: { type?: string; message?: string } };
    dettaglio = payload.error?.message ?? '';
  } catch {
    dettaglio = body.slice(0, 300);
  }

  const base = `Anthropic ha risposto ${status}`;
  if (!dettaglio) return `${base}.`;

  // Lo strumento va abilitato da un amministratore dell'organizzazione: è la
  // causa più frequente, e nessuna modifica al codice la risolve. Vale la pena
  // dire dove si mette mano invece di lasciare il messaggio dell'API da solo.
  if (/not enabled|disabled/i.test(dettaglio) && /web.?search/i.test(dettaglio)) {
    return (
      `${base}: la ricerca web non è abilitata per questa organizzazione. ` +
      'Un amministratore deve attivarla nelle impostazioni della Console Claude ' +
      `(Privacy). Messaggio del fornitore: ${dettaglio}`
    );
  }

  if (/credit|balance|quota/i.test(dettaglio)) {
    return `${base}: credito insufficiente. Messaggio del fornitore: ${dettaglio}`;
  }

  if (/model/i.test(dettaglio)) {
    return (
      `${base}: modello non valido o non disponibile. Controlla AI_SEARCH_MODEL. ` +
      `Messaggio del fornitore: ${dettaglio}`
    );
  }

  return `${base}: ${dettaglio}`;
}

export class AnthropicWebSearchProvider implements WebSearchProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  private buildBody(request: WebSearchRequest, allowedCallers: boolean) {
    return JSON.stringify({
      model: this.model,
      max_tokens: 2048,
      system:
        'Cerchi fonti di riferimento per un manuale tecnico. Usa lo strumento di ricerca ' +
        'e limitati a raccogliere gli indirizzi pertinenti: non riassumere, non commentare.',
      messages: [{ role: 'user', content: request.query }],
      tools: [
        {
          type: TOOL_TYPE,
          name: 'web_search',
          max_uses: 3,
          ...(allowedCallers ? { allowed_callers: ['direct'] } : {}),
          ...(request.allowedDomains && request.allowedDomains.length > 0
            ? { allowed_domains: request.allowedDomains }
            : {}),
        },
      ],
    });
  }

  private async call(body: string): Promise<Response> {
    try {
      return await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
      });
    } catch (error) {
      throw new ProviderError('Rete non raggiungibile.', true, this.name, error);
    }
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const maxResults = Math.min(request.maxResults ?? 10, 20);

    let response = await this.call(this.buildBody(request, false));

    // Alcuni modelli richiedono `allowed_callers: ["direct"]`. Invece di
    // mandarlo sempre — e rischiare di essere rifiutati da chi non lo prevede —
    // si riprova una volta sola, e soltanto se è l'API a chiederlo.
    if (response.status === 400) {
      const detail = await response.clone().text().catch(() => '');
      if (/allowed_callers/i.test(detail)) {
        response = await this.call(this.buildBody(request, true));
      }
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const body = await response.text().catch(() => '');
      throw new ProviderError(describeApiError(response.status, body), retryable, this.name);
    }

    const payload = (await response.json()) as {
      content?: ContentBlock[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        server_tool_use?: { web_search_requests?: number };
      };
    };

    const hits: WebSearchHit[] = [];
    const visti = new Set<string>();

    for (const block of payload.content ?? []) {
      if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue;

      for (const result of block.content) {
        if (result.type !== 'web_search_result' || typeof result.url !== 'string') continue;
        if (visti.has(result.url)) continue;

        visti.add(result.url);
        hits.push({ url: result.url, title: (result.title ?? '').slice(0, 300), snippet: '' });

        if (hits.length >= maxResults) break;
      }
      if (hits.length >= maxResults) break;
    }

    const searches = payload.usage?.server_tool_use?.web_search_requests ?? 0;

    return {
      provider: this.name,
      model: this.model,
      hits,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? 0,
        outputTokens: payload.usage?.output_tokens ?? 0,
      },
      searches,
      estimatedCostUsd: (searches / 1000) * COST_PER_THOUSAND_SEARCHES,
      warnings:
        hits.length === 0
          ? ['La ricerca non ha prodotto risultati per questa interrogazione.']
          : [],
    };
  }
}
