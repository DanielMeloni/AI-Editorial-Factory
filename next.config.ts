import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    // Il payload massimo accettato dalle Server Action.
    // Gli archivi ZIP NON transitano da qui: vengono caricati
    // direttamente su Supabase Storage tramite signed upload URL.
    serverActions: { bodySizeLimit: '1mb' },
  },
  async headers() {
    /**
     * Intestazioni comuni a ogni risposta.
     *
     * La politica sui frame è però in due varianti, e la ragione è precisa:
     * l'anteprima del volume viene mostrata dentro un iframe della stessa
     * applicazione, e `frame-ancestors 'none'` vieta di incorniciare il
     * documento a chiunque — compresa la pagina che lo ospita. Il browser
     * rifiuta la connessione, ed è il comportamento corretto: siamo noi a
     * chiedere una cosa che avevamo vietato.
     *
     * L'eccezione vale per quel solo percorso e solo verso la stessa origine.
     * Allargare la regola generale avrebbe permesso a chiunque di incorniciare
     * qualunque pagina dell'applicazione, che è un'altra cosa.
     */
    const comuni = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
      },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    ];

    // `script-src` include 'unsafe-inline' perché Next.js inietta gli script di
    // idratazione senza nonce. È un compromesso dichiarato, non una
    // dimenticanza: una CSP con nonce richiede di rendere dinamica ogni pagina,
    // anche quelle statiche. Il resto è chiuso: niente form verso l'esterno,
    // connessioni solo verso Supabase e l'origine stessa.
    const csp = (frameAncestors: string) =>
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://*.supabase.co",
        "font-src 'self' data:",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        `frame-ancestors ${frameAncestors}`,
        'upgrade-insecure-requests',
      ].join('; ');

    return [
      {
        // L'anteprima del volume: incorniciabile, ma soltanto da qui.
        source: '/api/projects/:projectId/preview',
        headers: [
          ...comuni,
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: csp("'self'") },
        ],
      },
      {
        source: '/((?!api/projects/[^/]+/preview).*)',
        headers: [
          ...comuni,
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: csp("'none'") },
        ],
      },
    ];
  },
};

/**
 * withWorkflow abilita le direttive 'use workflow' e 'use step' e genera le
 * rotte interne sotto app/.well-known/workflow/. Quel percorso è già escluso
 * dal matcher in src/proxy.ts: intercettarlo romperebbe la coda del workflow.
 */
export default withWorkflow(nextConfig);
