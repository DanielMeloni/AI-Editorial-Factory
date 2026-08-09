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
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
          {
            // Content Security Policy.
            //
            // `script-src` include 'unsafe-inline' perché Next.js inietta gli
            // script di idratazione senza nonce. È un compromesso dichiarato,
            // non una dimenticanza: una CSP con nonce richiede di rendere
            // dinamica ogni pagina, anche quelle statiche. Il resto è chiuso:
            // niente frame, niente form verso l'esterno, connessioni solo verso
            // Supabase e l'origine stessa.
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              'upgrade-insecure-requests',
            ].join('; '),
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
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
