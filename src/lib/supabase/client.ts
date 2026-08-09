import { createBrowserClient } from '@supabase/ssr';
import { getPublicEnv } from '@/lib/env';

/**
 * Client Supabase per i Client Component (browser).
 * Usa esclusivamente la publishable key: nessun segreto raggiunge il bundle.
 */
export function createClient() {
  const env = getPublicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
