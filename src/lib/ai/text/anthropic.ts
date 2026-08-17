import type { z } from 'zod';
import { ProviderError, type TextProvider, type TextRequest, type TextResult } from '../types';
import { estimateTokens } from './mock';

/** Prezzi indicativi per milione di token. */
const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
};

/**
 * Adapter Anthropic. Il modello non ha una modalità JSON dichiarativa: si
 * ottiene lo stesso risultato precompilando la risposta con `{`, così il
 * modello è costretto a proseguire con un oggetto.
 */
export class AnthropicTextProvider implements TextProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async generateStructured<T>(request: TextRequest, schema: z.ZodType<T>): Promise<TextResult<T>> {
    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxOutputTokens ?? 4096,
          temperature: request.temperature ?? 0.2,
          system: `${request.system}\n\nRispondi esclusivamente con un oggetto JSON valido, senza testo introduttivo.`,
          messages: [
            { role: 'user', content: request.prompt },
            { role: 'assistant', content: '{' },
          ],
        }),
      });
    } catch (error) {
      throw new ProviderError('Rete non raggiungibile.', true, this.name, error);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(
        `Anthropic ha risposto ${response.status}.`,
        retryable,
        this.name,
        undefined,
        response.status,
      );
    }

    const payload = (await response.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const continuation = payload.content?.find((block) => block.type === 'text')?.text ?? '';
    if (!continuation) throw new ProviderError('Risposta vuota.', true, this.name);

    // La risposta prosegue dopo la graffa precompilata.
    const raw = `{${continuation}`;

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

    const inputTokens = payload.usage?.input_tokens ?? estimateTokens(request.system + request.prompt);
    const outputTokens = payload.usage?.output_tokens ?? estimateTokens(raw);
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
