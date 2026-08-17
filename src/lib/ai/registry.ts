import 'server-only';

import { getServerEnv } from '@/lib/env';
import type { ImageProvider, TextProvider } from './types';
import { MockTextProvider } from './text/mock';
import { OpenAITextProvider } from './text/openai';
import { AnthropicTextProvider } from './text/anthropic';
import { RoutedTextProvider } from './text/routed';
import { MockImageProvider } from './image/mock';
import type { WebSearchProvider } from './search/types';
import { MockWebSearchProvider } from './search/mock';
import { AnthropicWebSearchProvider } from './search/anthropic';
import { DEFAULT_OPENAI_SEARCH_MODEL, OpenAIWebSearchProvider } from './search/openai';
import { DEFAULT_GEMINI_SEARCH_MODEL, GeminiWebSearchProvider } from './search/gemini';
import { RoutedWebSearchProvider } from './search/routed';

/**
 * Selezione del provider a partire dalla configurazione.
 *
 * Se un provider reale è richiesto ma la chiave manca, si ricade sul mock con
 * un avviso, invece di far fallire l'intero workflow: preferibile un'esecuzione
 * dichiaratamente simulata a un'interruzione opaca.
 */

type TextProviderName = 'mock' | 'openai' | 'anthropic';

const AGENT_ENV = {
  ingestion: 'AI_AGENT_INGESTION',
  source_auditor: 'AI_AGENT_SOURCE_AUDITOR',
  curriculum: 'AI_AGENT_CURRICULUM',
  technical_verifier: 'AI_AGENT_TECHNICAL_VERIFIER',
  technical_writer: 'AI_AGENT_TECHNICAL_WRITER',
  teaching: 'AI_AGENT_TEACHING',
  visual_art_director: 'AI_AGENT_VISUAL_ART_DIRECTOR',
  technical_diagram: 'AI_AGENT_TECHNICAL_DIAGRAM',
  illustration: 'AI_AGENT_ILLUSTRATION',
  cover: 'AI_AGENT_COVER',
  editorial_reviewer: 'AI_AGENT_EDITORIAL_REVIEWER',
  publishing: 'AI_AGENT_PUBLISHING',
} as const;

export type AgentProviderKey = keyof typeof AGENT_ENV;

interface TextRoute { provider: TextProviderName; model: string }

function parseTextRoute(value: string, source: string): TextRoute {
  const separator = value.indexOf(':');
  if (separator < 1 || separator === value.length - 1) {
    throw new Error(`${source} deve avere il formato provider:modello.`);
  }
  const provider = value.slice(0, separator) as TextProviderName;
  const model = value.slice(separator + 1);
  if (!['mock', 'openai', 'anthropic'].includes(provider)) {
    throw new Error(`${source}: provider testuale «${provider}» non supportato.`);
  }
  return { provider, model };
}

function instantiateTextProvider(route: TextRoute): { provider: TextProvider | null; warning: string | null } {
  const env = getServerEnv();
  if (route.provider === 'openai') {
    if (!env.OPENAI_API_KEY) {
      return {
        provider: null,
        warning: 'OPENAI_API_KEY assente: salto la route OpenAI.',
      };
    }
    return { provider: new OpenAITextProvider(env.OPENAI_API_KEY, route.model), warning: null };
  }
  if (route.provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) {
      return {
        provider: null,
        warning: 'ANTHROPIC_API_KEY assente: salto la route Anthropic.',
      };
    }
    return { provider: new AnthropicTextProvider(env.ANTHROPIC_API_KEY, route.model), warning: null };
  }
  return { provider: new MockTextProvider(route.model), warning: null };
}

export function getTextProvider(agentKey?: AgentProviderKey): { provider: TextProvider; degraded: string | null } {
  const env = getServerEnv();

  const variable = agentKey ? AGENT_ENV[agentKey] : null;
  const configured = variable ? env[variable] : undefined;
  if (configured) {
    const routes = [parseTextRoute(configured, variable!)];
    for (const fallback of (env.AI_AGENT_FALLBACKS ?? '').split(',').map((v) => v.trim()).filter(Boolean)) {
      routes.push(parseTextRoute(fallback, 'AI_AGENT_FALLBACKS'));
    }

    const warnings: string[] = [];
    const providers = routes
      .map((route) => {
        const built = instantiateTextProvider(route);
        if (built.warning) warnings.push(built.warning);
        return built.provider;
      })
      .filter((provider): provider is TextProvider => provider !== null);
    if (providers.length === 0) providers.push(new MockTextProvider());
    return {
      provider: providers.length === 1 ? providers[0]! : new RoutedTextProvider(providers),
      degraded: warnings.length ? warnings.join(' ') : null,
    };
  }

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

/**
 * Motore di ricerca web.
 *
 * Vale la stessa regola degli altri provider: chiave mancante significa mock
 * dichiarato, non interruzione. Con una differenza che conta — il mock della
 * ricerca **non produce risultati**. Un elenco di fonti inventate sembrerebbe
 * un risultato, e sarebbe peggio di un elenco vuoto.
 */
export function getWebSearchProvider(): { provider: WebSearchProvider; degraded: string | null } {
  const env = getServerEnv();

  if (env.AI_SEARCH_PROVIDER === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) {
      return {
        provider: new MockWebSearchProvider(),
        degraded:
          'AI_SEARCH_PROVIDER=anthropic ma ANTHROPIC_API_KEY è assente: la ricerca web non viene eseguita.',
      };
    }
    return {
      provider: new AnthropicWebSearchProvider(env.ANTHROPIC_API_KEY, env.AI_SEARCH_MODEL),
      degraded: null,
    };
  }

  if (env.AI_SEARCH_PROVIDER === 'openai') {
    if (!env.OPENAI_API_KEY) {
      return {
        provider: new MockWebSearchProvider(),
        degraded:
          'AI_SEARCH_PROVIDER=openai ma OPENAI_API_KEY è assente: la ricerca web non viene eseguita.',
      };
    }

    // Cambiare fornitore senza cambiare il modello è una svista frequente, e
    // produrrebbe un errore oscuro dall'altra parte. Si corregge qui, dicendolo.
    const coerente = searchModelFor('openai', env.AI_SEARCH_MODEL);
    return {
      provider: new OpenAIWebSearchProvider(env.OPENAI_API_KEY, coerente.model),
      degraded: coerente.note,
    };
  }

  if (env.AI_SEARCH_PROVIDER === 'gemini') {
    if (!env.GEMINI_API_KEY) {
      return {
        provider: new MockWebSearchProvider(),
        degraded:
          'AI_SEARCH_PROVIDER=gemini ma GEMINI_API_KEY è assente: la ricerca web non viene eseguita.',
      };
    }

    const coerente = searchModelFor('gemini', env.AI_SEARCH_MODEL);
    const gemini = new GeminiWebSearchProvider(env.GEMINI_API_KEY, coerente.model);
    if (env.OPENAI_API_KEY) {
      return {
        provider: new RoutedWebSearchProvider([
          gemini,
          new OpenAIWebSearchProvider(env.OPENAI_API_KEY, DEFAULT_OPENAI_SEARCH_MODEL),
        ]),
        degraded:
          coerente.note ??
          'Gemini è configurato come ricerca primaria; OpenAI verrà usato automaticamente su 400, 404, 429 o errore temporaneo.',
      };
    }
    return {
      provider: gemini,
      degraded: coerente.note,
    };
  }

  return { provider: new MockWebSearchProvider(env.AI_SEARCH_MODEL), degraded: null };
}

/**
 * Modello coerente con il fornitore scelto.
 *
 * Un identificativo `claude-…` inviato a OpenAI non è un errore di battitura da
 * perdonare in silenzio: è una configurazione incoerente. Viene corretta con il
 * predefinito del fornitore, e la sostituzione viene dichiarata.
 */
export function searchModelFor(
  provider: 'openai' | 'anthropic' | 'gemini',
  configured: string,
): { model: string; note: string | null } {
  const normalized = configured.replace(/^models\//i, '');
  if (provider === 'gemini' && /^gemini-2\.5-pro$/i.test(normalized)) {
    return {
      model: DEFAULT_GEMINI_SEARCH_MODEL,
      note:
        `AI_SEARCH_MODEL=«${configured}» non è più disponibile per i nuovi utenti Gemini: ` +
        `uso «${DEFAULT_GEMINI_SEARCH_MODEL}». Aggiorna la variabile d'ambiente.`,
    };
  }

  const prefissi = {
    openai: /^(gpt|o\d)/i,
    anthropic: /^claude/i,
    gemini: /^gemini/i,
  } as const;

  if (prefissi[provider].test(normalized)) return { model: normalized, note: null };

  const predefiniti = {
    openai: DEFAULT_OPENAI_SEARCH_MODEL,
    anthropic: 'claude-sonnet-5',
    gemini: DEFAULT_GEMINI_SEARCH_MODEL,
  } as const;
  const predefinito = predefiniti[provider];
  return {
    model: predefinito,
    note:
      `AI_SEARCH_MODEL=«${configured}» non è un modello ${provider}: uso «${predefinito}». ` +
      'Allinea la variabile per evitare sorprese.',
  };
}

/** Vero se la ricerca web è configurata e produrrà risultati reali. */
export function isWebSearchEnabled(): boolean {
  const env = getServerEnv();
  if (env.AI_SEARCH_PROVIDER === 'anthropic') return Boolean(env.ANTHROPIC_API_KEY);
  if (env.AI_SEARCH_PROVIDER === 'openai') return Boolean(env.OPENAI_API_KEY);
  if (env.AI_SEARCH_PROVIDER === 'gemini') return Boolean(env.GEMINI_API_KEY);
  return false;
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
