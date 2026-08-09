import { describe, expect, it } from 'vitest';
import { compareEditorial, parseEditorialName, parseRoman } from '@/lib/ingest/ordering';

describe('riconoscimento della numerazione', () => {
  it.each([
    ['capitolo-11-incremental-tables.md', 11, 'Incremental tables'],
    ['capitolo-01-introduzione.md', 1, 'Introduzione'],
    ['cap11.md', 11, null],
    ['chapter_11.md', 11, null],
    ['ch-11-tabelle.md', 11, 'Tabelle'],
    ['11-incremental.md', 11, 'Incremental'],
    ['011-incremental.md', 11, 'Incremental'],
  ])('legge %s come capitolo %i', (name, expected, title) => {
    const parsed = parseEditorialName(name);
    expect(parsed.kind).toBe('part');
    expect(parsed.number).toBe(expected);
    if (title !== null) expect(parsed.titleHint).toBe(title);
  });

  it.each([
    ['appendice-a-glossario.md', 1, 'A', 'Glossario'],
    ['appendice-b.md', 2, 'B', null],
    ['appendix-c-errori.md', 3, 'C', 'Errori'],
    ['app-j.md', 10, 'J', null],
  ])('legge %s come appendice %s', (name, number, label, title) => {
    const parsed = parseEditorialName(name);
    expect(parsed.kind).toBe('appendix');
    expect(parsed.number).toBe(number);
    expect(parsed.label).toBe(label);
    if (title !== null) expect(parsed.titleHint).toBe(title);
  });

  it('riconosce le parti in numeri romani', () => {
    expect(parseEditorialName('parte-ii-fondamenti')).toMatchObject({
      kind: 'part',
      number: 2,
      titleHint: 'Fondamenti',
    });
    expect(parseEditorialName('part-iv')).toMatchObject({ number: 4 });
  });

  it('riconosce apertura e chiusura del volume', () => {
    expect(parseEditorialName('prefazione.md').kind).toBe('front_matter');
    expect(parseEditorialName('introduzione.md').kind).toBe('front_matter');
    expect(parseEditorialName('bibliografia.md').kind).toBe('back_matter');
    expect(parseEditorialName('glossario.md').kind).toBe('back_matter');
  });
});

describe('numeri romani', () => {
  it.each([
    ['i', 1], ['iv', 4], ['ix', 9], ['xiv', 14], ['xl', 40], ['mcmxciv', 1994],
  ])('converte %s in %i', (input, expected) => {
    expect(parseRoman(input)).toBe(expected);
  });

  it('rifiuta ciò che non è un numero romano', () => {
    expect(parseRoman('abc')).toBeNull();
    expect(parseRoman('')).toBeNull();
    expect(parseRoman('11')).toBeNull();
  });
});

describe('ordinamento editoriale', () => {
  it('mette il capitolo 11 dopo il 10 e non dopo l’1', () => {
    const capitoli = [1, 2, 10, 11, 20, 3].map((number) => ({
      kind: 'part' as const,
      number,
      title: `Capitolo ${number}`,
    }));

    const ordinati = [...capitoli].sort(compareEditorial).map((c) => c.number);
    expect(ordinati).toEqual([1, 2, 3, 10, 11, 20]);

    // Controprova: l'ordinamento alfabetico sbaglierebbe.
    const alfabetico = capitoli.map((c) => String(c.number)).sort();
    expect(alfabetico).toEqual(['1', '10', '11', '2', '20', '3']);
  });

  it('colloca apertura, parti, appendici e chiusura nell’ordine giusto', () => {
    const elementi = [
      { kind: 'appendix' as const, number: 1, title: 'Glossario' },
      { kind: 'back_matter' as const, number: null, title: 'Bibliografia' },
      { kind: 'part' as const, number: 2, title: 'Secondo' },
      { kind: 'front_matter' as const, number: null, title: 'Prefazione' },
      { kind: 'part' as const, number: 1, title: 'Primo' },
    ];

    expect([...elementi].sort(compareEditorial).map((e) => e.title)).toEqual([
      'Prefazione', 'Primo', 'Secondo', 'Glossario', 'Bibliografia',
    ]);
  });

  it('mette in coda gli elementi senza numero', () => {
    const elementi = [
      { kind: 'part' as const, number: null, title: 'Senza numero' },
      { kind: 'part' as const, number: 5, title: 'Quinto' },
    ];
    expect([...elementi].sort(compareEditorial).map((e) => e.title)).toEqual([
      'Quinto', 'Senza numero',
    ]);
  });
});
