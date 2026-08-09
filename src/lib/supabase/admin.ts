import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getPublicEnv, getServerEnv } from '@/lib/env';

/**
 * Client con service role: IGNORA la Row Level Security.
 *
 * Regole d'uso, non negoziabili:
 *  - solo da codice server (l'import di `server-only` lo garantisce);
 *  - mai in un Server Component che renderizza dati utente;
 *  - ogni chiamata deve essere preceduta da un controllo esplicito di
 *    appartenenza all'organizzazione (vedi src/lib/auth/guards.ts);
 *  - riservato agli step dei workflow, che girano senza sessione utente.
 */
export function createAdminClient() {
  const publicEnv = getPublicEnv();
  const serverEnv = getServerEnv();

  if (!serverEnv.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY non configurata: le operazioni con privilegi elevati sono disabilitate.',
    );
  }

  return createSupabaseClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    },
  );
}
