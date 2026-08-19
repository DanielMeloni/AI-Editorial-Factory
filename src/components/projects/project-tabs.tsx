'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, Circle, Lock } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { COMING_SOON_LABEL } from '@/lib/navigation/items';
import type { StatoScheda } from '@/lib/projects/progress';

/**
 * Le schede del progetto come flusso.
 *
 * L'ordine è quello in cui si lavora e il colore dice a che punto è ciascuna
 * tappa: verde ciò che è concluso, giallo ciò che aspetta te, grigio ciò che
 * dipende ancora da qualcos'altro. Sono gli stessi tre stati dell'anello nella
 * panoramica — una barra che usasse colori diversi racconterebbe due storie
 * dello stesso lavoro.
 *
 * Le schede che non sono una tappa — le esecuzioni, le figure, le pubblicazioni
 * — restano neutre. Colorarle direbbe qualcosa che non è vero: non c'è un
 * momento in cui le esecuzioni sono «concluse».
 */

interface Tab {
  segment: string;
  label: string;
  available: boolean;
  /** Fase del lavoro a cui la scheda appartiene. */
  fase: string;
}

const TABS: Tab[] = [
  { segment: '', label: 'Panoramica', available: true, fase: '' },

  { segment: 'sources', label: 'Fonti', available: true, fase: 'Preparazione' },
  { segment: 'structure', label: 'Struttura', available: true, fase: 'Preparazione' },

  { segment: 'reviews', label: 'Revisioni', available: true, fase: 'Lavorazione' },
  { segment: 'workflows', label: 'Esecuzioni', available: true, fase: 'Lavorazione' },

  { segment: 'visual-studio', label: 'Figure', available: true, fase: 'Visuale' },
  { segment: 'cover-studio', label: 'Copertina', available: true, fase: 'Visuale' },

  { segment: 'preview', label: 'Anteprima', available: true, fase: 'Uscita' },
  { segment: 'blog', label: 'Blog', available: true, fase: 'Uscita' },
  { segment: 'courses', label: 'Corsi', available: true, fase: 'Uscita' },
  { segment: 'exports', label: 'Pubblicazioni', available: true, fase: 'Uscita' },

  { segment: 'settings', label: 'Impostazioni', available: false, fase: '' },
];

const SEGNO = {
  pronto: { classe: 'text-success', etichetta: 'concluso' },
  attesa: { classe: 'text-warning', etichetta: 'aspetta te' },
  bloccata: { classe: 'text-muted-foreground/50', etichetta: 'non ancora disponibile' },
} as const;

function Indicatore({ stato }: { stato: StatoScheda }) {
  if (stato === 'pronto') return <Check className="size-3.5 shrink-0" aria-hidden="true" />;
  if (stato === 'attesa')
    return <Circle className="size-2.5 shrink-0 fill-current" aria-hidden="true" />;
  return <Lock className="size-3 shrink-0" aria-hidden="true" />;
}

export function ProjectTabs({
  projectId,
  stati = {},
}: {
  projectId: string;
  /** Stato per segmento. Assente significa: scheda che non è una tappa. */
  stati?: Partial<Record<string, StatoScheda>>;
}) {
  const pathname = usePathname();
  const base = `/projects/${projectId}`;

  return (
    <nav aria-label="Sezioni del progetto" className="border-b border-border-subtle">
      <ul className="flex items-center gap-0.5 overflow-x-auto">
        {TABS.map((tab, indice) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          const isActive = tab.segment ? pathname.startsWith(href) : pathname === base;
          const apreFase = tab.fase !== '' && TABS[indice - 1]?.fase !== tab.fase;
          const stato = stati[tab.segment];

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
            <Fragment key={tab.label}>
              {apreFase ? (
                <li
                  aria-hidden="true"
                  className="flex items-center whitespace-nowrap pl-2 pr-1 text-[10px] uppercase tracking-wider text-muted-foreground/60"
                >
                  {tab.fase}
                </li>
              ) : null}

              <li>
                <Link
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  title={stato ? `${tab.label} — ${SEGNO[stato].etichetta}` : tab.label}
                  className={cn(
                    'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
                  )}
                >
                  {stato ? (
                    <span className={cn('flex items-center', SEGNO[stato].classe)}>
                      <Indicatore stato={stato} />
                    </span>
                  ) : null}

                  {tab.label}

                  {/* Il colore non basta: lo stato va detto anche a parole. */}
                  {stato ? (
                    <span className="sr-only"> — {SEGNO[stato].etichetta}</span>
                  ) : null}
                  <span className="sr-only">{tab.fase ? ` — fase ${tab.fase}` : ''}</span>
                </Link>
              </li>
            </Fragment>
          );
        })}
      </ul>
    </nav>
  );
}
