import { describe, expect, it } from 'vitest';
import { applySelectedHunks, computeDiff, summarizeDiff } from '@/lib/review/diff';

const ORIGINALE = `# Capitolo 11

Prima riga.
Seconda riga.
Terza riga.`;

const PROPOSTA = `# Capitolo 11

Prima riga modificata.
Seconda riga.
Terza riga.
Riga aggiunta in coda.`;

describe('confronto fra versioni', () => {
  it('riconosce due testi identici senza produrre blocchi', () => {
    const diff = computeDiff(ORIGINALE, ORIGINALE);
    expect(diff.identical).toBe(true);
    expect(diff.hunks).toEqual([]);
    expect(summarizeDiff(diff)).toBe('Nessuna differenza.');
  });

  it('individua le righe modificate e quelle aggiunte', () => {
    const diff = computeDiff(ORIGINALE, PROPOSTA);
    expect(diff.identical).toBe(false);
    expect(diff.stats.added).toBeGreaterThan(0);
    expect(diff.hunks.length).toBeGreaterThanOrEqual(2);
  });

  it('evidenzia le parole cambiate quando una riga sostituisce una riga', () => {
    const diff = computeDiff('Prima riga.', 'Prima riga modificata.');
    const hunk = diff.hunks[0];

    expect(hunk?.words).not.toBeNull();
    expect(hunk!.words!.some((w) => w.kind === 'added' && w.text.includes('modificata'))).toBe(true);
    expect(hunk!.words!.some((w) => w.kind === 'same' && w.text.includes('Prima'))).toBe(true);
  });

  it('non tenta il confronto per parole su blocchi multiriga', () => {
    const diff = computeDiff('a\nb\nc', 'x\ny\nz');
    expect(diff.hunks[0]?.words).toBeNull();
  });

  it('numera le righe rispetto a entrambe le versioni', () => {
    const diff = computeDiff(ORIGINALE, PROPOSTA);
    for (const line of diff.lines) {
      if (line.kind === 'context') {
        expect(line.baseLine).not.toBeNull();
        expect(line.proposedLine).not.toBeNull();
      }
      if (line.kind === 'removed') expect(line.proposedLine).toBeNull();
      if (line.kind === 'added') expect(line.baseLine).toBeNull();
    }
  });
});

describe('ricomposizione da blocchi selezionati', () => {
  /**
   * Sono le due proprietà su cui poggia l'approvazione parziale: se non
   * valgono, il revisore potrebbe salvare un testo che non ha mai visto.
   */
  it('con tutti i blocchi selezionati restituisce esattamente la proposta', () => {
    const diff = computeDiff(ORIGINALE, PROPOSTA);
    const tutti = diff.hunks.map((h) => h.id);
    expect(applySelectedHunks(ORIGINALE, PROPOSTA, tutti)).toBe(PROPOSTA);
  });

  it('senza alcun blocco selezionato restituisce esattamente l’originale', () => {
    expect(applySelectedHunks(ORIGINALE, PROPOSTA, [])).toBe(ORIGINALE);
  });

  it('applica solo il blocco scelto', () => {
    const diff = computeDiff(ORIGINALE, PROPOSTA);
    const soloIlPrimo = applySelectedHunks(ORIGINALE, PROPOSTA, [diff.hunks[0]!.id]);

    expect(soloIlPrimo).toContain('Prima riga modificata.');
    expect(soloIlPrimo).not.toContain('Riga aggiunta in coda.');
  });

  it('vale anche su una sola riga sostituita', () => {
    const base = 'una riga';
    const proposta = 'un’altra riga';
    const diff = computeDiff(base, proposta);

    expect(applySelectedHunks(base, proposta, diff.hunks.map((h) => h.id))).toBe(proposta);
    expect(applySelectedHunks(base, proposta, [])).toBe(base);
  });

  it('gestisce le righe rimosse senza sostituzione', () => {
    const base = 'a\nb\nc';
    const proposta = 'a\nc';
    const diff = computeDiff(base, proposta);

    expect(applySelectedHunks(base, proposta, diff.hunks.map((h) => h.id))).toBe(proposta);
    expect(applySelectedHunks(base, proposta, [])).toBe(base);
  });

  it('gestisce l’inserimento in testa al documento', () => {
    const base = 'b\nc';
    const proposta = 'a\nb\nc';
    const diff = computeDiff(base, proposta);

    expect(applySelectedHunks(base, proposta, diff.hunks.map((h) => h.id))).toBe(proposta);
    expect(applySelectedHunks(base, proposta, [])).toBe(base);
  });

  it('gestisce un testo vuoto ai due estremi', () => {
    expect(applySelectedHunks('', 'nuovo', computeDiff('', 'nuovo').hunks.map((h) => h.id))).toBe('nuovo');
    expect(applySelectedHunks('vecchio', '', computeDiff('vecchio', '').hunks.map((h) => h.id))).toBe('');
  });

  it('resta esatta su un documento realistico con più modifiche sparse', () => {
    const base = Array.from({ length: 40 }, (_, i) => `riga ${i + 1}`).join('\n');
    const proposta = base
      .split('\n')
      .flatMap((riga, i) => {
        if (i === 4) return ['riga 5 riscritta'];
        if (i === 12) return [];                       // rimossa
        if (i === 25) return [riga, 'riga inserita'];  // inserimento
        return [riga];
      })
      .join('\n');

    const diff = computeDiff(base, proposta);
    expect(diff.hunks.length).toBeGreaterThanOrEqual(3);
    expect(applySelectedHunks(base, proposta, diff.hunks.map((h) => h.id))).toBe(proposta);
    expect(applySelectedHunks(base, proposta, [])).toBe(base);
  });

  it('ogni sottoinsieme di blocchi produce un testo coerente', () => {
    const diff = computeDiff(ORIGINALE, PROPOSTA);
    const ids = diff.hunks.map((h) => h.id);

    // Tutti i sottoinsiemi possibili: nessuno deve perdere righe di contesto.
    for (let mask = 0; mask < 2 ** ids.length; mask += 1) {
      const selezione = ids.filter((_, i) => (mask >> i) & 1);
      const risultato = applySelectedHunks(ORIGINALE, PROPOSTA, selezione);
      expect(risultato).toContain('# Capitolo 11');
      expect(risultato).toContain('Seconda riga.');
    }
  });
});
