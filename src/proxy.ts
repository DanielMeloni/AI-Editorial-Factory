import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

/**
 * In Next.js 16 `proxy.ts` sostituisce `middleware.ts`.
 *
 * Il matcher esclude deliberatamente `.well-known/workflow/`: il Workflow SDK
 * usa quel percorso per la propria coda interna e l'intercettazione lo rompe
 * (errore "Queue operation failed"). L'esclusione e' gia' presente ora, prima
 * dell'introduzione dei workflow nella Fase 3, per evitare regressioni.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
};
