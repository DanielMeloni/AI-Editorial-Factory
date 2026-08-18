import type { z } from 'zod';
import { ProviderError, type TextProvider, type TextRequest, type TextResult } from '../types';
import { readErrorDetail } from '../http';
import { objectSchemaFor } from '../schema';
import { estimateTokens } from './mock';

/** Prezzi indicativi per milione di token. */
const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
};

/** Nome dello strumento con cui il modello consegna la risposta. */
const TOOL_NAME = 'rispondi';

/**
 * Modelli che hanno già rifiutato `temperature`. Vive quanto il processo.
 *
 * Senza memoria ogni passaggio del workflow ripaga lo stesso tentativo a vuoto:
 * la lezione va imparata una volta sola.
 */
const temperatureRifiutata = new Set<string>();

/** Isola l'oggetto JSON dentro una risposta testuale, tolte eventuali recinzioni. */
function extractJsonObject(text: string): string {
  const senzaRecinzioni = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const inizio = senzaRecinzioni.indexOf('{');
  const fine = senzaRecinzioni.lastIndexOf('}');
  if (inizio === -1 || fine <= inizio) return senzaRecinzioni.trim();
  return senzaRecinzioni.slice(inizio, fine + 1);
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

interface SendOptions {
  withTemperature: boolean;
  tool: ReturnType<typeof objectSchemaFor>;
}

/**
 * Adapter Anthropic.
 *
 * L'output strutturato si ottiene con uno strumento a chiamata forzata: il
 * modello deve compilare `input_schema`, e la risposta arriva già come oggetto
 * invece che come testo da indovinare. È anche l'unica strada rimasta — la
 * vecchia precompilazione della risposta con `{` non è più accettata dai
 * modelli recenti, che pretendono una conversazione chiusa da un turno utente.
 *
 * Sul parametro `temperature` vale la stessa logica: le generazioni più recenti
 * lo rifiutano con un 400 invece di ignorarlo. Un elenco di modelli scritto qui
 * invecchierebbe al primo rilascio, quindi si prova e, se il rifiuto riguarda
 * proprio quel parametro, si ripete senza — dichiarandolo tra i warning, perché
 * il determinismo richiesto non è stato applicato.
 */
export class AnthropicTextProvider implements TextProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  private async send(request: TextRequest, options: SendOptions): Promise<Response> {
    const istruzioni = options.tool
      ? `${request.system}\n\nConsegna la risposta chiamando lo strumento «${TOOL_NAME}».`
      : `${request.system}\n\nRispondi esclusivamente con un oggetto JSON valido, senza testo introduttivo.`;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxOutputTokens ?? 4096,
      system: istruzioni,
      messages: [{ role: 'user', content: request.prompt }],
    };
    if (options.withTemperature) body.temperature = request.temperature ?? 0.2;
    if (options.tool) {
      body.tools = [
        {
          name: TOOL_NAME,
          description: 'Restituisce la risposta strutturata richiesta.',
          input_schema: options.tool.schema,
        },
      ];
      body.tool_choice = { type: 'tool', name: TOOL_NAME };
    }

    try {
      return await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new ProviderError('Rete non raggiungibile.', true, this.name, error);
    }
  }

  async generateStructured<T>(request: TextRequest, schema: z.ZodType<T>): Promise<TextResult<T>> {
    const warnings: string[] = [];

    const tool = objectSchemaFor(schema);
    if (!tool) {
      warnings.push(
        'Schema non traducibile in JSON Schema: la risposta è stata richiesta come testo, ' +
          'senza il vincolo dello strumento.',
      );
    }

    const withTemperatureIniziale = !temperatureRifiutata.has(this.model);
    if (!withTemperatureIniziale) {
      // La variante è nota, il tentativo a vuoto si evita: l'adattamento però
      // va dichiarato lo stesso, perché vale per questa risposta come per la
      // prima.
      warnings.push(
        `«${this.model}» non accetta «temperature»: la richiesta è partita senza. ` +
          'L’output non è vincolato alla temperatura richiesta.',
      );
    }

    let withTemperature = withTemperatureIniziale;
    let response = await this.send(request, { withTemperature, tool });

    // Unico ritentativo previsto: il rifiuto della temperatura. Ogni altro 400
    // è una configurazione da correggere, non un caso da aggirare.
    if (!response.ok && response.status === 400) {
      const detail = await readErrorDetail(response);
      if (/temperature/i.test(detail)) {
        warnings.push(
          `«${this.model}» non accetta più «temperature»: la richiesta è stata ripetuta senza. ` +
            'L’output non è vincolato alla temperatura richiesta.',
        );
        temperatureRifiutata.add(this.model);
        withTemperature = false;
        response = await this.send(request, { withTemperature, tool });
      } else {
        throw new ProviderError(
          `Anthropic ha risposto 400${detail ? `: ${detail}` : '.'}`,
          false,
          this.name,
          undefined,
          400,
        );
      }
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const detail = await readErrorDetail(response);
      throw new ProviderError(
        `Anthropic ha risposto ${response.status}${detail ? `: ${detail}` : '.'}`,
        retryable,
        this.name,
        undefined,
        response.status,
      );
    }

    const payload = (await response.json()) as {
      content?: ContentBlock[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const blocks = payload.content ?? [];

    let parsedJson: unknown;
    let raw: string;

    const chiamata = blocks.find((block) => block.type === 'tool_use' && block.name === TOOL_NAME);
    if (chiamata) {
      const argomenti = chiamata.input;
      parsedJson = tool?.wrapped ? (argomenti as { valore?: unknown } | null)?.valore : argomenti;
      raw = JSON.stringify(parsedJson ?? null);
    } else {
      const testo = blocks.find((block) => block.type === 'text')?.text ?? '';
      if (!testo) throw new ProviderError('Risposta vuota.', true, this.name);
      raw = extractJsonObject(testo);
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        throw new ProviderError('Il modello non ha restituito JSON valido.', true, this.name);
      }
    }

    const validated = schema.safeParse(parsedJson);
    if (!validated.success) {
      throw new ProviderError(
        `Output non conforme allo schema: ${validated.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
        true,
        this.name,
      );
    }

    const inputTokens = payload.usage?.input_tokens ?? estimateTokens(request.system + request.prompt);
    const outputTokens = payload.usage?.output_tokens ?? estimateTokens(raw);
    const price = PRICE_PER_MILLION[this.model];
    if (!price) warnings.push(`Tariffa sconosciuta per «${this.model}»: costo non stimato.`);

    return {
      provider: this.name,
      model: this.model,
      data: validated.data,
      raw,
      usage: { inputTokens, outputTokens },
      estimatedCostUsd: price
        ? (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output
        : 0,
      warnings,
    };
  }
}
