import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ProviderError, type TextProvider } from '@/lib/ai/types';
import { RoutedTextProvider } from '@/lib/ai/text/routed';
import { RoutedWebSearchProvider } from '@/lib/ai/search/routed';

const schema = z.object({ value: z.string() });
const request = { system: 'test', prompt: 'test' };

function provider(
  name: string,
  model: string,
  generateStructured: TextProvider['generateStructured'],
): TextProvider {
  return { name, model, generateStructured };
}

describe('routing dei provider testuali', () => {
  it('passa al provider successivo dopo un 429', async () => {
    const primary = provider(
      'openai',
      'gpt-primary',
      vi.fn().mockRejectedValue(new ProviderError('quota', true, 'openai', undefined, 429)),
    );
    const fallback = provider(
      'anthropic',
      'claude-fallback',
      vi.fn().mockResolvedValue({
        provider: 'anthropic',
        model: 'claude-fallback',
        data: { value: 'ok' },
        raw: '{"value":"ok"}',
        usage: { inputTokens: 1, outputTokens: 1 },
        estimatedCostUsd: 0,
        warnings: [],
      }),
    );

    const result = await new RoutedTextProvider([primary, fallback]).generateStructured(
      request,
      schema,
    );

    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-fallback');
    expect(result.warnings.join(' ')).toMatch(/fallback attivato/i);
  });

  it('non nasconde un errore 400 non recuperabile', async () => {
    const fallbackCall = vi.fn();
    const primary = provider(
      'openai',
      'gpt-primary',
      vi.fn().mockRejectedValue(new ProviderError('input errato', false, 'openai', undefined, 400)),
    );
    const fallback = provider('anthropic', 'claude-fallback', fallbackCall);

    await expect(
      new RoutedTextProvider([primary, fallback]).generateStructured(request, schema),
    ).rejects.toThrow(/input errato/);
    expect(fallbackCall).not.toHaveBeenCalled();
  });
});

describe('routing della ricerca web', () => {
  it('passa da Gemini a OpenAI dopo un 400', async () => {
    const gemini = {
      name: 'gemini',
      model: 'gemini-3.6-flash',
      search: vi.fn().mockRejectedValue(
        new ProviderError('Gemini ha risposto 400.', false, 'gemini', undefined, 400),
      ),
    };
    const openai = {
      name: 'openai',
      model: 'gpt-5.6-luna',
      search: vi.fn().mockResolvedValue({
        provider: 'openai',
        model: 'gpt-5.6-luna',
        hits: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        searches: 1,
        estimatedCostUsd: 0,
        warnings: [],
      }),
    };

    const result = await new RoutedWebSearchProvider([gemini, openai]).search({ query: 'test' });

    expect(openai.search).toHaveBeenCalledOnce();
    expect(result.provider).toBe('openai');
    expect(result.warnings.join(' ')).toMatch(/fallback ricerca/i);
  });
});
