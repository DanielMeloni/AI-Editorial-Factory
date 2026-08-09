import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NAV_ICONS, PRIMARY_NAV, SECONDARY_NAV } from '@/lib/navigation/items';
import { SidebarNav } from '@/components/layout/sidebar-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

describe('serializzabilità delle voci di navigazione', () => {
  /**
   * Queste voci attraversano il confine fra Server Component e Client
   * Component. React vi accetta solo valori serializzabili: un componente o una
   * funzione provocherebbero, a runtime, l'errore «Functions cannot be passed
   * directly to Client Components» — invisibile a build e typecheck.
   *
   * structuredClone fallisce esattamente sugli stessi valori.
   */
  it.each([
    ['PRIMARY_NAV', PRIMARY_NAV],
    ['SECONDARY_NAV', SECONDARY_NAV],
  ])('%s contiene solo dati serializzabili', (_nome, voci) => {
    expect(() => structuredClone(voci.map((v) => ({ ...v })))).not.toThrow();

    for (const voce of voci) {
      for (const [chiave, valore] of Object.entries(voce)) {
        expect(typeof valore, `${voce.label}.${chiave}`).not.toBe('function');
        expect(typeof valore, `${voce.label}.${chiave}`).not.toBe('symbol');
        if (typeof valore === 'object' && valore !== null) {
          throw new Error(`${voce.label}.${chiave} è un oggetto: usa un identificatore testuale.`);
        }
      }
    }
  });

  it('ogni icona dichiarata esiste nel catalogo dei nomi ammessi', () => {
    for (const voce of [...PRIMARY_NAV, ...SECONDARY_NAV]) {
      expect(NAV_ICONS).toContain(voce.icon);
    }
  });
});

describe('SidebarNav', () => {
  it('disegna un collegamento per le voci disponibili', () => {
    render(<SidebarNav items={PRIMARY_NAV} label="Navigazione principale" />);

    const dashboard = screen.getByRole('link', { name: /Dashboard/ });
    expect(dashboard).toHaveAttribute('href', '/dashboard');
    expect(dashboard).toHaveAttribute('aria-current', 'page');

    expect(screen.getByRole('link', { name: /Progetti/ })).toHaveAttribute('href', '/projects');
  });

  it('disattiva le voci non disponibili annunciandolo agli screen reader', () => {
    render(<SidebarNav items={PRIMARY_NAV} label="Navigazione principale" />);

    const nonDisponibili = PRIMARY_NAV.filter((voce) => !voce.available);
    const disattivate = screen.queryAllByTitle('Disponibile prossimamente');

    expect(disattivate).toHaveLength(nonDisponibili.length);
    for (const voce of disattivate) {
      expect(voce).toHaveAttribute('aria-disabled', 'true');
    }
    // Una voce disattivata non deve mai essere anche un collegamento.
    for (const voce of nonDisponibili) {
      expect(screen.queryByRole('link', { name: new RegExp(voce.label) })).toBeNull();
    }
  });

  it('rende disattivata una voce non disponibile passata esplicitamente', () => {
    // Workflow, Revisioni e Visual Studio sono usciti dalla navigazione globale
    // perché appartengono a un progetto: il comportamento va comunque
    // verificato, altrimenti la regressione passerebbe inosservata.
    render(
      <SidebarNav
        items={[{ href: '/da-fare', label: 'Non pronta', icon: 'visual', available: false }]}
        label="Prova"
      />,
    );

    const voce = screen.getByTitle('Disponibile prossimamente');
    expect(voce).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Disponibile prossimamente')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Non pronta/ })).toBeNull();
  });

  it('rende un’icona per ogni voce', () => {
    const { container } = render(<SidebarNav items={PRIMARY_NAV} label="Navigazione" />);
    expect(container.querySelectorAll('svg')).toHaveLength(PRIMARY_NAV.length);
  });
});
