import type { z } from 'zod';
import { ProviderError, type TextProvider, type TextRequest, type TextResult } from '../types';
import { readErrorDetail } from '../http';
import { jsonSchemaFor } from '../schema';
import { estimateTokens } from './mock';

/**
 * Adapter OpenAI, via API HTTP diretta: nessun SDK, nessuna dipendenza da
 * aggiornare.
 *
 * La forma dell'output è dichiarata al modello come JSON Schema, non affidata
 * al prompt: i prompt degli agenti descrivono il compito, non la struttura
 * della risposta, e senza schema il modello produrrebbe un oggetto plausibile
 * ma non conforme. La validazione resta comunque a Zod, che conosce anche i
 * vincoli che lo schema non trasmette.
 *
 * I parametri accettati cambiano da una famiglia di modelli all'altra: le
 * generazioni recenti rifiutano `max_tokens` (vogliono `max_completion_tokens`)
 * e non ammettono una `temperature` diversa da quella predefinita. Rifiutano
 * con un 400, non con un avviso. Invece di tenere qui un elenco di modelli —
 * che invecchierebbe al primo rilascio — l'adapter impara dal rifiuto: corregge
 * ciò che è stato contestato, ripete la chiamata e ricorda la variante buona
 * per quel modello, così la lezione si paga una volta sola per processo.
 */

/**
 * Prezzi indicativi per milione di token. Aggiornali se cambiano le tariffe.
 *
 * Sono le tariffe a contesto breve: oltre la soglia di contesto lungo OpenAI
 * raddoppia, e gli endpoint con residenza dei dati aggiungono un 10%. La stima
 * qui è quindi un minimo, non un consuntivo.
 */
const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gpt-5.6': { input: 2.5, output: 15 },
  'gpt-5.6-sol': { input: 2.5, output: 15 },
  'gpt-5.6-terra': { input: 1, output: 6 },
  'gpt-5.6-luna': { input: 0.1, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

const SCHEMA_NAME = 'risposta';

/** Variante di richiesta accettata da un modello. */
interface Dialect {
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  withTemperature: boolean;
  /** `json_schema` vincola la forma; `json_object` chiede solo JSON valido. */
  format: 'json_schema' | 'json_object';
}

const DEFAULT_DIALECT: Dialect = {
  tokenParam: 'max_tokens',
  withTemperature: true,
  format: 'json_schema',
};

/** Varianti già apprese, per modello. Vive quanto il processo. */
const learnedDialects = new Map<string, Dialect>();

/**
 * Correzione suggerita dal messaggio d'errore, se ce n'è una.
 *
 * `null` significa che il 400 non riguarda qualcosa che sappiamo adattare: in
 * quel caso l'errore va riportato, non aggirato.
 */
function adaptDialect(dialect: Dialect, detail: string): { dialect: Dialect; note: string } | null {
  if (dialect.tokenParam === 'max_tokens' && /max_tokens/i.test(detail)) {
    return {
      dialect: { ...dialect, tokenParam: 'max_completion_tokens' },
      note: 'il modello richiede «max_completion_tokens» al posto di «max_tokens»',
    };
  }
  if (dialect.withTemperature && /temperature/i.test(detail)) {
    return {
      dialect: { ...dialect, withTemperature: false },
      note: 'il modello non accetta «temperature»: l’output non è vincolato alla temperatura richiesta',
    };
  }
  if (dialect.format === 'json_schema' && /json_schema|response_format|schema/i.test(detail)) {
    return {
      dialect: { ...dialect, format: 'json_object' },
      note: 'il modello non accetta lo schema dichiarato: la forma è stata chiesta nel prompt',
    };
  }
  return null;
}

export class OpenAITextProvider implements TextProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  private async send(
    request: TextRequest,
    dialect: Dialect,
    schema: Record<string, unknown> | null,
  ): Promise<Response> {
    const dichiarato = dialect.format === 'json_schema' ? schema : null;

    // La parola «json» nel messaggio è un requisito dell'API quando si usa
    // `response_format`. Qui non è un espediente: quando lo schema non viene
    // dichiarato, questo è anche l'unico posto in cui la forma attesa passa.
    const istruzioni = [
      request.system,
      '',
      'Rispondi esclusivamente con un oggetto JSON valido, senza testo introduttivo.',
      'Formato della risposta: json.',
      dichiarato || !schema ? '' : `Lo schema json da rispettare è:\n${JSON.stringify(schema)}`,
    ]
      .filter(Boolean)
      .join('\n');

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: istruzioni },
        { role: 'user', content: request.prompt },
      ],
      response_format: dichiarato
        ? { type: 'json_schema', json_schema: { name: SCHEMA_NAME, schema: dichiarato, strict: false } }
        : { type: 'json_object' },
      [dialect.tokenParam]: request.maxOutputTokens ?? 4096,
    };
    if (dialect.withTemperature) body.temperature = request.temperature ?? 0.2;

    try {
      return await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new ProviderError('Rete non raggiungibile.', true, this.name, error);
    }
  }

  async generateStructured<T>(request: TextRequest, schema: z.ZodType<T>): Promise<TextResult<T>> {
    const warnings: string[] = [];

    const jsonSchema = jsonSchemaFor(schema);
    if (!jsonSchema) {
      warnings.push(
        'Schema non traducibile in JSON Schema: la forma della risposta non è stata dichiarata al modello.',
      );
    }

    // La variante appresa evita i tentativi a vuoto, ma gli adattamenti che
    // cambiano l'esito vanno dichiarati anche quando non si ripagano.
    const appreso = learnedDialects.get(this.model);
    if (appreso && !appreso.withTemperature) {
      warnings.push(
        `«${this.model}» non accetta «temperature»: l’output non è vincolato alla temperatura richiesta.`,
      );
    }
    if (appreso && appreso.format === 'json_object') {
      warnings.push(
        `«${this.model}» non accetta lo schema dichiarato: la forma è stata chiesta nel prompt.`,
      );
    }

    let dialect = appreso ?? DEFAULT_DIALECT;
    let response = await this.send(request, dialect, jsonSchema);

    // Tre correzioni al massimo: tanti sono gli aspetti adattabili, e OpenAI
    // ne segnala uno per volta.
    for (let correzioni = 0; !response.ok && response.status === 400 && correzioni < 3; correzioni += 1) {
      const detail = await readErrorDetail(response);
      const adattamento = adaptDialect(dialect, detail);
      if (!adattamento) {
        throw new ProviderError(
          `OpenAI ha risposto 400${detail ? `: ${detail}` : '.'}`,
          false,
          this.name,
          undefined,
          400,
        );
      }
      warnings.push(`Chiamata adattata a «${this.model}»: ${adattamento.note}.`);
      dialect = adattamento.dialect;
      response = await this.send(request, dialect, jsonSchema);
    }

    if (!response.ok) {
      // 429 e 5xx hanno senso da ritentare; 4xx no.
      const retryable = response.status === 429 || response.status >= 500;
      const detail = await readErrorDetail(response);
      throw new ProviderError(
        `OpenAI ha risposto ${response.status}${detail ? `: ${detail}` : '.'}`,
        retryable,
        this.name,
        undefined,
        response.status,
      );
    }

    // La variante è valida: le chiamate successive a questo modello partono già
    // corrette, senza ripagare i tentativi.
    learnedDialects.set(this.model, dialect);

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const raw = payload.choices?.[0]?.message?.content ?? '';
    if (!raw) throw new ProviderError('Risposta vuota.', true, this.name);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new ProviderError('Il modello non ha restituito JSON valido.', true, this.name);
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

    const inputTokens = payload.usage?.prompt_tokens ?? estimateTokens(request.system + request.prompt);
    const outputTokens = payload.usage?.completion_tokens ?? estimateTokens(raw);
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
