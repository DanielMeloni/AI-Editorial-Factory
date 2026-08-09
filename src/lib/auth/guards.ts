import 'server-only';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

/**
 * Legge l'utente corrente verificando la firma del JWT.
 * Restituisce null se non autenticato. Non effettua redirect.
 */
export async function getOptionalUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  const subject = data?.claims?.sub;
  if (error || typeof subject !== 'string' || subject.length === 0) return null;

  const email = typeof data?.claims?.email === 'string' ? data.claims.email : null;
  return { id: subject, email };
}

/**
 * Da usare in ogni Server Component, Server Action e Route Handler protetto.
 * Il proxy fa gia' un primo filtro, ma l'autorizzazione va sempre riverificata
 * nel punto in cui i dati vengono effettivamente letti o scritti.
 */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getOptionalUser();
  if (!user) redirect('/login');
  return user;
}
