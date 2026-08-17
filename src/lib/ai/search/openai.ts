import { ProviderError } from '../types';
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchHit } from './types';

/**
 * Ricerca web tramite lo strumento nativo di OpenAI (Responses API).
 *
 * Vale la stessa divisione dell'adapter Anthropic: qui si raccolgono soltanto
 * gli indirizzi. Il modello scrive anche una risposta in prosa, e quella viene
 * **ignorata di proposito** — non serve un riassunto di seconda mano, servono
 * le fonti, che verranno aperte una per una prima di essere mostrate.
 *
 * Gli indirizzi arrivano nelle `annotations` di tipo `url_citation`: sono le
 * pagine che il modello dichiara di aver consultato.
 */

/** Modello predefinito quando la configurazione ne indica uno di un altro fornitore. */
export const DEFAULT_OPENAI_SEARCH_MODEL = 'gpt-5.6-luna';

interface Annotation {
  type?: string;
  url?: string;
  title?: string;
}

interface ContentPart {
  type?: string;
  annotations?: Annotation[];
}

interface OutputItem {
  type?: string;
  content?: ContentPart[];
}

/** Estrae il motivo reale di un errore, invece di riferire solo il codice. */
export function describeOpenAiError(status: number, body: string): string {
  let dettaglio = '';

  try {
    const payload = JSON.parse(body) as { error?: { message?: string; code?: string } };
    dettaglio = payload.error?.message ?? '';
  } catch {
    dettaglio = body.slice(0, 300);
  }

  const base = `OpenAI ha risposto ${status}`;
  if (!dettaglio) return `${base}.`;

  if (/quota|billing|credit/i.test(dettaglio)) {
    return `${base}: credito o quota esauriti. Messaggio del fornitore: ${dettaglio}`;
  }

  if (/model/i.test(dettaglio)) {
    return (
      `${base}: modello non valido o senza accesso alla ricerca web. Controlla AI_SEARCH_MODEL. ` +
      `Messaggio del fornitore: ${dettaglio}`
    );
  }

  if (status === 401) {
    return `${base}: chiave non valida. Controlla OPENAI_API_KEY. Messaggio: ${dettaglio}`;
  }

  return `${base}: ${dettaglio}`;
}

export class OpenAIWebSearchProvider implements WebSearchProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const maxResults = Math.min(request.maxResults ?? 10, 20);

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          tools: [
            {
              type: 'web_search',
              ...(request.allowedDomains && request.allowedDomains.length > 0
                ? { filters: { allowed_domains: request.allowedDomains } }
                : {}),
            },
          ],
          input:
            'Cerca fonti di riferimento per un manuale tecnico e cita le pagine consultate. ' +
            `Argomento: ${request.query}`,
        }),
      });
    } catch (error) {
      throw new ProviderError('Rete non raggiungibile.', true, this.name, error);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const body = await response.text().catch(() => '');
      throw new ProviderError(
        describeOpenAiError(response.status, body),
        retryable,
        this.name,
        undefined,
        response.status,
      );
    }

    const payload = (await response.json()) as {
      output?: OutputItem[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const hits: WebSearchHit[] = [];
    const visti = new Set<string>();
    let ricerche = 0;

    for (const item of payload.output ?? []) {
      if (item.type === 'web_search_call') {
        ricerche += 1;
        continue;
      }
      if (item.type !== 'message') continue;

      for (const parte of item.content ?? []) {
        for (const annotazione of parte.annotations ?? []) {
          if (annotazione.type !== 'url_citation' || typeof annotazione.url !== 'string') continue;
          if (visti.has(annotazione.url)) continue;

          visti.add(annotazione.url);
          hits.push({
            url: annotazione.url,
            title: (annotazione.title ?? '').slice(0, 300),
            snippet: '',
          });

          if (hits.length >= maxResults) break;
        }
        if (hits.length >= maxResults) break;
      }
      if (hits.length >= maxResults) break;
    }

    return {
      provider: this.name,
      model: this.model,
      hits,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? 0,
        outputTokens: payload.usage?.output_tokens ?? 0,
      },
      searches: ricerche,
      // La tariffa dello strumento non è nota a questo codice: dichiararne una
      // inventata falserebbe la contabilità, che qui serve a decidere.
      estimatedCostUsd: 0,
      warnings: [
        ...(hits.length === 0
          ? ['La ricerca non ha prodotto risultati per questa interrogazione.']
          : []),
        ...(ricerche > 0
          ? [`${ricerche} ricerche eseguite: costo a carico di OpenAI, non stimato qui.`]
          : []),
      ],
    };
  }
}
