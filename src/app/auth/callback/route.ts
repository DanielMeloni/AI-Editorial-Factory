import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeRedirectTarget } from '@/lib/auth/routes';

/**
 * Scambia il codice ricevuto via email con una sessione (PKCE).
 * Usato da conferma registrazione e recupero password.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeRedirectTarget(searchParams.get('next'), '/dashboard');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=link_non_valido`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=link_scaduto`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
