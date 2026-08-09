import 'server-only';

import { getServerEnv } from '@/lib/env';
import type { ImageProvider, TextProvider } from './types';
import { MockTextProvider } from './text/mock';
import { OpenAITextProvider } from './text/openai';
import { AnthropicTextProvider } from './text/anthropic';
import { MockImageProvider } from './image/mock';

/**
 * Selezione del provider a partire dalla configurazione.
 *
 * Se un provider reale è richiesto ma la chiave manca, si ricade sul mock con
 * un avviso, invece di far fallire l'intero workflow: preferibile un'esecuzione
 * dichiaratamente simulata a un'interruzione opaca.
 */

export function getTextProvider(): { provider: TextProvider; degraded: string | null } {
  const env = getServerEnv();

  switch (env.AI_TEXT_PROVIDER) {
    case 'openai':
      if (!env.OPENAI_API_KEY) {
        return {
          provider: new MockTextProvider(),
          degraded: 'AI_TEXT_PROVIDER=openai ma OPENAI_API_KEY è assente: uso il provider mock.',
        };
      }
      return { provider: new OpenAITextProvider(env.OPENAI_API_KEY, env.AI_TEXT_MODEL), degraded: null };

    case 'anthropic':
      if (!env.ANTHROPIC_API_KEY) {
        return {
          provider: new MockTextProvider(),
          degraded: 'AI_TEXT_PROVIDER=anthropic ma ANTHROPIC_API_KEY è assente: uso il provider mock.',
        };
      }
      return {
        provider: new AnthropicTextProvider(env.ANTHROPIC_API_KEY, env.AI_TEXT_MODEL),
        degraded: null,
      };

    case 'mock':
    default:
      return { provider: new MockTextProvider(env.AI_TEXT_MODEL), degraded: null };
  }
}

export function getImageProvider(): { provider: ImageProvider; degraded: string | null } {
  const env = getServerEnv();

  // L'adapter visuale reale arriva con la Fase 5: oggi solo il mock è
  // implementato, e viene dichiarato come tale invece di fingere altro.
  if (env.AI_IMAGE_PROVIDER !== 'mock') {
    return {
      provider: new MockImageProvider(),
      degraded: `Il provider visuale «${env.AI_IMAGE_PROVIDER}» non è ancora implementato: uso il mock.`,
    };
  }

  return { provider: new MockImageProvider(env.AI_IMAGE_MODEL), degraded: null };
}

/** Vero quando nessun credito verrà consumato. */
export function isFullyMocked(): boolean {
  const env = getServerEnv();
  const textMocked =
    env.AI_TEXT_PROVIDER === 'mock' ||
    (env.AI_TEXT_PROVIDER === 'openai' && !env.OPENAI_API_KEY) ||
    (env.AI_TEXT_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY);

  return textMocked && env.AI_IMAGE_PROVIDER === 'mock';
}
