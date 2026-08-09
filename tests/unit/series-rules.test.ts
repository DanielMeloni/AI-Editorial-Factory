import { describe, expect, it } from 'vitest';
import {
  analyzeImpact,
  resolveRule,
  resolveRuleSet,
  summarizeImpact,
  type SeriesRule,
  type VolumeOverride,
  type VolumeSnapshot,
} from '@/lib/series/rules';
import {
  VOLUME_STATUSES,
  VOLUME_STATUS_LABELS,
  canRenumberFreely,
  isVolumeImmutable,
} from '@/lib/series/types';

const regolaPalette: SeriesRule<string> = {
  scope: 'palette',
  key: 'colore-primario',
  value: '#16233d',
  mode: 'inherited',
};

const regolaFont: SeriesRule<string> = {
  scope: 'fonts',
  key: 'font-titoli',
  value: 'Georgia',
  mode: 'locked',
};

describe('risoluzione di una singola regola', () => {
  it('senza deroga il volume eredita il valore della collana', () => {
    const esito = resolveRule(regolaPalette, undefined);

    expect(esito.ok).toBe(true);
    if (esito.ok) {
      expect(esito.value).toBe('#16233d');
      expect(esito.mode).toBe('inherited');
      expect(esito.fromSeries).toBe(true);
      expect(esito.reason).toBeNull();
    }
  });

  it('una regola bloccata resta bloccata anche senza deroga', () => {
    const esito = resolveRule(regolaFont, undefined);
    expect(esito.ok).toBe(true);
    if (esito.ok) expect(esito.mode).toBe('locked');
  });

  it('con deroga motivata il volume usa il valore locale', () => {
    const deroga: VolumeOverride<string> = {
      scope: 'palette',
      key: 'colore-primario',
      value: '#2f7d72',
      reason: 'Il verde distingue il volume su BigQuery dagli altri della collana.',
    };

    const esito = resolveRule(regolaPalette, deroga);

    expect(esito.ok).toBe(true);
    if (esito.ok) {
      expect(esito.value).toBe('#2f7d72');
      expect(esito.mode).toBe('overridden');
      expect(esito.fromSeries).toBe(false);
      expect(esito.reason).toContain('verde distingue');
    }
  });

  /**
   * Il punto che rende utile il sistema: una deroga senza motivazione è
   * indistinguibile da un errore, e fra due anni nessuno saprà spiegarla.
   */
  it('rifiuta una deroga priva di motivazione', () => {
    const esito = resolveRule(regolaPalette, {
      scope: 'palette',
      key: 'colore-primario',
      value: '#000000',
      reason: '   ',
    });

    expect(esito.ok).toBe(false);
    if (!esito.ok) {
      expect(esito.code).toBe('motivazione_mancante');
      expect(esito.message).toMatch(/motivazione/i);
    }
  });

  /** Un fallimento silenzioso lascerebbe credere che la deroga sia attiva. */
  it('rifiuta una deroga su regola bloccata, invece di ignorarla', () => {
    const esito = resolveRule(regolaFont, {
      scope: 'fonts',
      key: 'font-titoli',
      value: 'Helvetica',
      reason: 'Preferenza personale.',
    });

    expect(esito.ok).toBe(false);
    if (!esito.ok) {
      expect(esito.code).toBe('regola_bloccata');
      expect(esito.message).toMatch(/bloccata/i);
    }
  });

  it('segnala una deroga su una regola che la collana non definisce', () => {
    const esito = resolveRule(undefined, {
      scope: 'grid',
      key: 'colonne',
      value: '12',
      reason: 'Motivata.',
    });

    expect(esito.ok).toBe(false);
    if (!esito.ok) expect(esito.code).toBe('regola_inesistente');
  });
});

describe('risoluzione dell’intero insieme', () => {
  const regole = [regolaPalette, regolaFont];

  it('separa le regole risolte da quelle rifiutate', () => {
    const esito = resolveRuleSet(regole, [
      { scope: 'palette', key: 'colore-primario', value: '#2f7d72', reason: 'Distinzione del volume.' },
      { scope: 'fonts', key: 'font-titoli', value: 'Helvetica', reason: 'Motivata ma non ammessa.' },
    ]);

    expect(esito.resolved).toHaveLength(1);
    expect(esito.resolved[0]!.mode).toBe('overridden');
    expect(esito.rejected).toHaveLength(1);

    expect(esito.rejected[0]!.code).toBe('regola_bloccata');
  });

  it('senza deroghe eredita tutto', () => {
    const esito = resolveRuleSet(regole, []);
    expect(esito.resolved).toHaveLength(2);
    expect(esito.rejected).toHaveLength(0);
    expect(esito.resolved.every((r) => r.fromSeries)).toBe(true);
  });

  it('segnala una deroga orfana: la regola della collana è stata rimossa', () => {
    const esito = resolveRuleSet(regole, [
      { scope: 'grid', key: 'colonne', value: '12', reason: 'Motivata.' },
    ]);

    expect(esito.rejected.some((r) => r.code === 'regola_inesistente')).toBe(true);
  });
});

describe('stati del volume', () => {
  it('ogni stato ha un’etichetta italiana', () => {
    for (const stato of VOLUME_STATUSES) {
      expect(VOLUME_STATUS_LABELS[stato]).toBeTruthy();
    }
  });

  it('pubblicato e archiviato sono immutabili', () => {
    expect(isVolumeImmutable('published')).toBe(true);
    expect(isVolumeImmutable('archived')).toBe(true);
    expect(isVolumeImmutable('draft')).toBe(false);
    expect(isVolumeImmutable('approved')).toBe(false);
  });

  it('il riordino libero vale solo prima della stesura avanzata', () => {
    expect(canRenumberFreely('planned')).toBe(true);
    expect(canRenumberFreely('draft')).toBe(true);
    expect(canRenumberFreely('published')).toBe(false);
    expect(canRenumberFreely('ready_for_publication')).toBe(false);
  });
});

describe('analisi dell’impatto di una modifica', () => {
  const volumi: VolumeSnapshot[] = [
    { volumeId: 'v1', volumeNumber: 1, title: 'Dataform in Pratica', status: 'published', overrides: [] },
    { volumeId: 'v2', volumeNumber: 2, title: 'BigQuery in Pratica', status: 'draft', overrides: [] },
    {
      volumeId: 'v3',
      volumeNumber: 3,
      title: 'Dataplex in Pratica',
      status: 'draft',
      overrides: [
        { scope: 'palette', key: 'colore-primario', value: '#c98a2b', reason: 'Colore proprio del volume.' },
      ],
    },
    { volumeId: 'v4', volumeNumber: 4, title: 'Volume futuro', status: 'planned', overrides: [] },
  ];

  const impatti = analyzeImpact([{ scope: 'palette', key: 'colore-primario' }], volumi);

  /**
   * Il ramo decisivo: un volume pubblicato non entra nell'applicazione
   * automatica. Una copia stampata non si aggiorna.
   */
  it('un volume pubblicato richiede una nuova edizione, non una modifica', () => {
    const primo = impatti.find((i) => i.volumeId === 'v1');
    expect(primo!.kind).toBe('richiede_nuova_edizione');
    expect(primo!.explanation).toMatch(/nuova edizione/i);
  });

  it('un volume in stesura senza deroghe riceve la modifica', () => {
    expect(impatti.find((i) => i.volumeId === 'v2')!.kind).toBe('applicabile');
    expect(impatti.find((i) => i.volumeId === 'v4')!.kind).toBe('applicabile');
  });

  it('una deroga locale protegge il volume dalla modifica', () => {
    const terzo = impatti.find((i) => i.volumeId === 'v3');
    expect(terzo!.kind).toBe('protetto_da_deroga');
    expect(terzo!.explanation).toContain('colore-primario');
  });

  it('produce un impatto per ogni volume, senza saltarne nessuno', () => {
    expect(impatti).toHaveLength(volumi.length);
  });

  it('il riepilogo segnala quando la decisione non è di routine', () => {
    const riepilogo = summarizeImpact(impatti);

    expect(riepilogo.applicabili).toBe(2);
    expect(riepilogo.protetti).toBe(1);
    expect(riepilogo.nuoveEdizioni).toBe(1);
    expect(riepilogo.richiedeAttenzione).toBe(true);
  });

  it('senza volumi pubblicati la modifica è ordinaria', () => {
    const soloBozze = analyzeImpact(
      [{ scope: 'tone', key: 'registro' }],
      volumi.filter((v) => v.status !== 'published'),
    );
    expect(summarizeImpact(soloBozze).richiedeAttenzione).toBe(false);
  });
});
