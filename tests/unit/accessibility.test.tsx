import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { StatusPill } from '@/components/ui/status-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { DiffViewer } from '@/components/review/diff-viewer';
import { computeDiff } from '@/lib/review/diff';
import { RUN_STATUSES } from '@/lib/workflow/status';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ refresh: () => {} }) }));

describe('campi di form', () => {
  it('collega etichetta, suggerimento ed errore al controllo', () => {
    render(
      <Field id="email" label="Email" hint="Serve per accedere." error="Indirizzo non valido" required>
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} invalid />}
      </Field>,
    );

    const campo = screen.getByLabelText(/Email/);
    expect(campo).toHaveAttribute('aria-invalid', 'true');

    const descritto = campo.getAttribute('aria-describedby') ?? '';
    expect(descritto).toContain('email-hint');
    expect(descritto).toContain('email-error');
  });

  it('annuncia l’errore agli screen reader', () => {
    render(
      <Field id="password" label="Password" error="Troppo corta">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} />}
      </Field>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Troppo corta');
  });

  it('non produce aria-describedby vuoto quando non serve', () => {
    render(
      <Field id="nome" label="Nome">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} />}
      </Field>,
    );

    expect(screen.getByLabelText('Nome')).not.toHaveAttribute('aria-describedby');
  });

  it('marca visivamente e testualmente i campi obbligatori', () => {
    const { container } = render(
      <Field id="titolo" label="Titolo" required>
        {({ id }) => <Input id={id} required />}
      </Field>,
    );

    expect(screen.getByLabelText(/Titolo/)).toBeRequired();
    // L'asterisco è decorativo: l'informazione utile è l'attributo required.
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('*');
  });
});

describe('messaggi', () => {
  it('usa role=alert per gli errori e role=status per il resto', () => {
    const { rerender } = render(<Alert tone="danger">Errore grave</Alert>);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(<Alert tone="info">Informazione</Alert>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('nasconde le icone decorative agli screen reader', () => {
    const { container } = render(<Alert tone="warning" title="Attenzione">Testo</Alert>);
    const icona = container.querySelector('svg');
    expect(icona).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('indicatori di stato', () => {
  it('comunica lo stato a parole, non solo con il colore', () => {
    for (const stato of RUN_STATUSES) {
      const { unmount } = render(<StatusPill status={stato} />);
      // Ogni stato deve produrre un'etichetta testuale leggibile.
      expect(document.body.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      unmount();
    }
  });

  it('il pallino colorato è decorativo', () => {
    const { container } = render(<StatusPill status="running" />);
    expect(container.querySelector('span[aria-hidden="true"]')).toBeInTheDocument();
  });
});

describe('navigazione', () => {
  it('il percorso di navigazione è una nav etichettata con l’elemento corrente marcato', () => {
    render(
      <Breadcrumb items={[{ label: 'Progetti', href: '/projects' }, { label: 'Dataform' }]} />,
    );

    expect(screen.getByRole('navigation', { name: 'Percorso di navigazione' })).toBeInTheDocument();
    expect(screen.getByText('Dataform')).toHaveAttribute('aria-current', 'page');
  });
});

describe('confronto fra versioni', () => {
  const diff = computeDiff('prima riga\nseconda', 'prima riga modificata\nseconda');

  it('distingue aggiunte e rimozioni anche senza colore', () => {
    render(
      <DiffViewer
        lines={diff.lines}
        hunks={diff.hunks}
        selected={new Set(diff.hunks.map((h) => h.id))}
        onToggle={() => {}}
      />,
    );

    // Il simbolo + / − è visibile, e la natura della riga è annunciata a parole.
    expect(document.body.textContent).toMatch(/riga aggiunta|riga rimossa/);
  });

  it('ogni blocco ha una casella di selezione con etichetta associata', () => {
    render(
      <DiffViewer
        lines={diff.lines}
        hunks={diff.hunks}
        selected={new Set()}
        onToggle={() => {}}
      />,
    );

    const caselle = screen.getAllByRole('checkbox');
    expect(caselle.length).toBe(diff.hunks.length);
    for (const casella of caselle) {
      expect(casella).toHaveAccessibleName();
    }
  });

  it('in sola lettura non espone caselle di selezione', () => {
    render(
      <DiffViewer
        lines={diff.lines}
        hunks={diff.hunks}
        selected={new Set()}
        onToggle={() => {}}
        readOnly
      />,
    );

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('stati vuoti', () => {
  it('espongono titolo e spiegazione come testo, non come immagine', () => {
    render(<EmptyState title="Nessun progetto" description="Creane uno per iniziare." />);
    expect(screen.getByText('Nessun progetto')).toBeInTheDocument();
    expect(screen.getByText('Creane uno per iniziare.')).toBeInTheDocument();
  });
});
