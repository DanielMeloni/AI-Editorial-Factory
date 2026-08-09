/**
 * Riconoscimento della numerazione editoriale.
 *
 * Il problema che risolve: ordinare per nome file mette il capitolo 11 subito
 * dopo il capitolo 1 e prima del 2. L'ordine di un'opera è dato dai numeri, non
 * dall'alfabeto. Qui il numero viene estratto e reso esplicito.
 */

export type EditorialKind = 'front_matter' | 'part' | 'appendix' | 'back_matter';

export interface ParsedLabel {
  kind: EditorialKind;
  /** Numero editoriale: 11 per il capitolo 11, 1 per l'appendice A. */
  number: number | null;
  /** Etichetta mostrata all'utente: '11' oppure 'A'. */
  label: string | null;
  /** Titolo ricavato dal nome, se il file non ne dichiara uno proprio. */
  titleHint: string | null;
}

const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

export function parseRoman(input: string): number | null {
  const value = input.toLowerCase();
  if (!/^[ivxlcdm]+$/.test(value)) return null;

  let total = 0;
  let previous = 0;
  for (let i = value.length - 1; i >= 0; i -= 1) {
    const current = ROMAN_VALUES[value[i]!]!;
    total += current < previous ? -current : current;
    previous = Math.max(previous, current);
  }
  return total > 0 && total < 4000 ? total : null;
}

/** Trasforma 'incremental-tables' in 'Incremental Tables'. */
export function humanizeSlug(slug: string): string {
  const cleaned = slug
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const FRONT_MATTER_WORDS = [
  'prefazione', 'introduzione', 'premessa', 'ringraziamenti', 'colophon',
  'indice', 'sommario', 'frontespizio', 'preface', 'foreword', 'toc',
];

const BACK_MATTER_WORDS = [
  'conclusioni', 'postfazione', 'bibliografia', 'glossario', 'colofone',
  'afterword', 'bibliography', 'glossary', 'index', 'colophon',
];

/**
 * Interpreta il nome di un file o di una cartella.
 *
 * Riconosce, fra le altre: `11-incremental-tables.md`, `cap11.md`,
 * `capitolo-11-tabelle.md`, `chapter_11.md`, `parte-02-fondamenti/`,
 * `parte-II-fondamenti/`, `appendice-a-glossario.md`, `appendix-b.md`.
 */
export function parseEditorialName(rawName: string): ParsedLabel {
  // Toglie l'estensione e normalizza i separatori.
  const withoutExtension = rawName.replace(/\.[a-z0-9]+$/i, '');
  const normalized = withoutExtension.replace(/[\s_]+/g, '-').toLowerCase();
  const bare = normalized.replace(/^-+|-+$/g, '');

  // --- Appendici: 'appendice-a-glossario', 'appendix-b', 'app-c' -----------
  const appendixMatch = /^(?:appendice|appendix|app)-?([a-z]|\d{1,2})(?:-(.*))?$/.exec(bare);
  if (appendixMatch) {
    const token = appendixMatch[1]!;
    const isLetter = /^[a-z]$/.test(token);
    return {
      kind: 'appendix',
      number: isLetter ? token.charCodeAt(0) - 96 : Number.parseInt(token, 10),
      label: isLetter ? token.toUpperCase() : token,
      titleHint: appendixMatch[2] ? humanizeSlug(appendixMatch[2]) : null,
    };
  }

  // --- Parti in numeri romani: 'parte-ii-fondamenti' -----------------------
  const romanPartMatch = /^(?:parte|part)-([ivxlcdm]+)(?:-(.*))?$/.exec(bare);
  if (romanPartMatch) {
    const roman = parseRoman(romanPartMatch[1]!);
    if (roman !== null) {
      return {
        kind: 'part',
        number: roman,
        label: String(roman),
        titleHint: romanPartMatch[2] ? humanizeSlug(romanPartMatch[2]) : null,
      };
    }
  }

  // --- Capitoli e parti numerati ------------------------------------------
  // Copre 'capitolo-11-x', 'cap11', 'chapter_11', 'ch-11', 'parte-02-x', '11-x'
  const numberedMatch =
    /^(?:(capitolo|capitolo|chapter|chap|cap|ch|parte|part|sezione|section|sec)-?)?(\d{1,3})(?:-(.*))?$/.exec(
      bare,
    );
  if (numberedMatch) {
    const keyword = numberedMatch[1] ?? '';
    const isPartKeyword = /^(parte|part)$/.test(keyword);
    return {
      kind: 'part',
      number: Number.parseInt(numberedMatch[2]!, 10),
      label: String(Number.parseInt(numberedMatch[2]!, 10)),
      titleHint: numberedMatch[3]
        ? humanizeSlug(numberedMatch[3])
        : isPartKeyword
          ? null
          : null,
    };
  }

  // --- Materiale di apertura e chiusura -----------------------------------
  const firstWord = bare.split('-')[0] ?? '';
  if (FRONT_MATTER_WORDS.includes(firstWord) || FRONT_MATTER_WORDS.includes(bare)) {
    return { kind: 'front_matter', number: null, label: null, titleHint: humanizeSlug(bare) };
  }
  if (BACK_MATTER_WORDS.includes(firstWord) || BACK_MATTER_WORDS.includes(bare)) {
    return { kind: 'back_matter', number: null, label: null, titleHint: humanizeSlug(bare) };
  }

  return { kind: 'part', number: null, label: null, titleHint: humanizeSlug(bare) };
}

/**
 * Ordina elementi editoriali: prima l'apertura, poi le parti numerate, poi le
 * appendici, infine la chiusura. A parità di categoria vince il numero; i non
 * numerati finiscono in coda, ordinati per titolo.
 */
const KIND_WEIGHT: Record<EditorialKind, number> = {
  front_matter: 0,
  part: 1,
  appendix: 2,
  back_matter: 3,
};

export function compareEditorial(
  a: { kind: EditorialKind; number: number | null; title: string },
  b: { kind: EditorialKind; number: number | null; title: string },
): number {
  const weight = KIND_WEIGHT[a.kind] - KIND_WEIGHT[b.kind];
  if (weight !== 0) return weight;

  if (a.number !== null && b.number !== null) return a.number - b.number;
  if (a.number !== null) return -1;
  if (b.number !== null) return 1;

  return a.title.localeCompare(b.title, 'it');
}
