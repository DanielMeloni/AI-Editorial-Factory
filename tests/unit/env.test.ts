import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function freshEnvModule() {
  vi.resetModules();
  return import('@/lib/env');
}

describe('validazione delle variabili di ambiente', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('accetta una configurazione pubblica valida', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_valoreDiProva123';

    const { getPublicEnv } = await freshEnvModule();
    expect(getPublicEnv().NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
  });

  it('lancia un errore leggibile se un URL non è assoluto', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'non-un-url';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_valoreDiProva123';

    const { getPublicEnv } = await freshEnvModule();
    expect(() => getPublicEnv()).toThrowError(/NEXT_PUBLIC_APP_URL/);
  });

  it('applica i valori predefiniti dei provider AI in modalità mock', async () => {
    delete process.env.AI_TEXT_PROVIDER;
    delete process.env.AI_IMAGE_PROVIDER;

    const { getServerEnv } = await freshEnvModule();
    const env = getServerEnv();
    expect(env.AI_TEXT_PROVIDER).toBe('mock');
    expect(env.AI_IMAGE_PROVIDER).toBe('mock');
  });

  it('rifiuta un provider testuale sconosciuto', async () => {
    process.env.AI_TEXT_PROVIDER = 'provider-inesistente';
    const { getServerEnv } = await freshEnvModule();
    expect(() => getServerEnv()).toThrowError(/AI_TEXT_PROVIDER/);
  });

  it('isSupabaseConfigured non solleva eccezioni quando manca la configurazione', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const { isSupabaseConfigured } = await freshEnvModule();
    expect(isSupabaseConfigured()).toBe(false);
  });
});
