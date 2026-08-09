'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { COMING_SOON_LABEL } from '@/lib/navigation/items';

interface Tab {
  segment: string;
  label: string;
  available: boolean;
}

const TABS: Tab[] = [
  { segment: '', label: 'Panoramica', available: true },
  { segment: 'sources', label: 'Fonti', available: true },
  { segment: 'structure', label: 'Struttura', available: true },
  { segment: 'workflows', label: 'Workflow', available: true },
  { segment: 'reviews', label: 'Revisioni', available: true },
  { segment: 'visual-studio', label: 'Visual', available: true },
  { segment: 'cover-studio', label: 'Copertina', available: true },
  { segment: 'exports', label: 'Pubblicazioni', available: true },
  { segment: 'settings', label: 'Impostazioni', available: false },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <nav aria-label="Sezioni del progetto" className="border-b border-border-subtle">
      <ul className="flex gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          const isActive = tab.segment ? pathname.startsWith(href) : pathname === base;

          if (!tab.available) {
            return (
              <li key={tab.label}>
                <span
                  aria-disabled="true"
                  title={COMING_SOON_LABEL}
                  className="flex cursor-not-allowed items-center whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground/50"
                >
                  {tab.label}
                  <span className="sr-only">{COMING_SOON_LABEL}</span>
                </span>
              </li>
            );
          }

          return (
            <li key={tab.label}>
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
