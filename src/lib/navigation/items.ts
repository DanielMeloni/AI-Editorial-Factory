import type { Route } from 'next';

/**
 * Voci di navigazione.
 *
 * Questo modulo contiene SOLO dati serializzabili: nessun componente React,
 * nessuna funzione. Le voci attraversano il confine fra Server Component e
 * Client Component, e attraverso quel confine React accetta esclusivamente
 * valori serializzabili — un componente passato come prop provoca l'errore
 * «Functions cannot be passed directly to Client Components».
 *
 * L'icona è quindi un nome; la corrispondenza con il componente vive nel
 * Client Component che la disegna (src/components/layout/sidebar-nav.tsx).
 */

export const NAV_ICONS = [
  'dashboard',
  'projects',
  'workflows',
  'reviews',
  'visual',
  'settings',
] as const;


export type NavIconName = (typeof NAV_ICONS)[number];

interface NavItemBase {
  label: string;
  icon: NavIconName;
}

/**
 * Una voce disponibile punta a una rotta realmente esistente (verificata da
 * `typedRoutes`). Una voce non disponibile resta visibile ma disattivata.
 */
export type NavItem = NavItemBase &
  ({ available: true; href: Route } | { available: false; href: string });

export const PRIMARY_NAV: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', available: true },
  { href: '/projects', label: 'Progetti', icon: 'projects', available: true },
  // Workflow, Revisioni e Visual Studio non compaiono qui: appartengono a un
  // progetto e si raggiungono dalle sue schede. Una voce globale porterebbe a
  // una rotta inesistente.
];

export const SECONDARY_NAV: readonly NavItem[] = [
  { href: '/settings', label: 'Impostazioni', icon: 'settings', available: true },
];

export const COMING_SOON_LABEL = 'Disponibile prossimamente';
