import type { z } from 'zod';
import { ProviderError, type TextProvider, type TextRequest, type TextResult } from '../types';
import { estimateTokens } from './mock';

/**
 * Adapter OpenAI, via API HTTP diretta: nessun SDK, nessuna dipendenza da
 * aggiornare. Usa la modalità JSON e valida il risultato contro lo schema.
 */

/** Prezzi indicativi per milione di token. Aggiornali se cambiano le tariffe. */
const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

export class OpenAITextProvider implements TextProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generateStructured<T>(request: TextRequest, schema: z.ZodType<T>): Promise<TextResult<T>> {
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxOutputTokens ?? 4096,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
        }),
      });
    } catch (error) {
      throw new ProviderError('Rete non raggiungibile.', true, this.name, error);
    }

    if (!response.ok) {
      // 429 e 5xx hanno senso da ritentare; 4xx no.
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(
        `OpenAI ha risposto ${response.status}.`,
        retryable,
        this.name,
        undefined,
        response.status,
      );
    }

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

    return {
      provider: this.name,
      model: this.model,
      data: validated.data,
      raw,
      usage: { inputTokens, outputTokens },
      estimatedCostUsd: price
        ? (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output
        : 0,
      warnings: price ? [] : [`Tariffa sconosciuta per «${this.model}»: costo non stimato.`],
    };
  }
}
