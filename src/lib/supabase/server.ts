import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getPublicEnv } from '@/lib/env';

/**
 * Client Supabase per Server Component, Server Action e Route Handler.
 * La sessione viaggia nei cookie; i Server Component non possono scriverli,
 * per questo `setAll` ignora l'errore: al refresh del token provvede il proxy.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Invocato da un Server Component: la scrittura dei cookie non e'
            // consentita. Il rinnovo del token avviene nel proxy.
          }
        },
      },
    },
  );
}
