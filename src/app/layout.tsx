import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'AI Editorial Factory',
    template: '%s · AI Editorial Factory',
  },
  description: 'Redazione multi-agente per manuali tecnici.',
  applicationName: 'AI Editorial Factory',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111a2e' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <a href="#contenuto-principale" className="skip-link">
          Salta al contenuto principale
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
