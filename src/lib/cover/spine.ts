import { z } from 'zod';

/**
 * Calcolo della larghezza del dorso.
 *
 * Non esiste un valore universale: dipende dalla carta e dal fornitore di
 * stampa. Per questo la formula è configurabile e il fattore va preso dalle
 * specifiche del fornitore, non indovinato.
 *
 * Le tre forme coprono il modo in cui i tipografi esprimono lo spessore:
 *
 *  - `mm_per_page`     — millimetri per pagina (comune in Europa)
 *  - `pages_per_inch`  — pagine per pollice, o PPI (comune negli Stati Uniti)
 *  - `fixed`           — valore imposto dal fornitore, da usare così com'è
 *
 * Il dorso è definitivo **solo** quando il numero di pagine è definitivo: una
 * pagina in più o in meno sposta la piega, e una copertina stampata con il
 * dorso sbagliato non si recupera.
 */

export const SPINE_FORMULAS = ['mm_per_page', 'pages_per_inch', 'fixed'] as const;
export type SpineFormula = (typeof SPINE_FORMULAS)[number];

export const SPINE_FORMULA_LABELS: Record<SpineFormula, string> = {
  mm_per_page: 'Millimetri per pagina',
  pages_per_inch: 'Pagine per pollice (PPI)',
  fixed: 'Valore fisso indicato dal fornitore',
};

export const SPINE_FORMULA_HINTS: Record<SpineFormula, string> = {
  mm_per_page:
    'Spessore di una singola pagina in millimetri. Il fornitore lo pubblica insieme alla grammatura della carta.',
  pages_per_inch:
    'Quante pagine stanno in un pollice di spessore. Più alto il valore, più sottile la carta.',
  fixed: 'Larghezza del dorso in millimetri, comunicata direttamente dal fornitore.',
};

const MM_PER_INCH = 25.4;

export const spineInputSchema = z.object({
  formula: z.enum(SPINE_FORMULAS),
  /** Interpretazione dipendente dalla formula: mm/pagina, PPI, oppure mm. */
  factor: z.number().positive('Il fattore deve essere maggiore di zero'),
  pageCount: z.number().int().positive('Il numero di pagine deve essere maggiore di zero'),
  /** Spessore dei due cartoni di copertina, per la brossura rigida. */
  coverThicknessMm: z.number().min(0).default(0),
});

export type SpineInput = z.infer<typeof spineInputSchema>;

export type SpineResult =
  | { ok: true; spineMm: number; breakdown: string }
  | { ok: false; reason: string };

/** Arrotonda a due decimali: sotto il centesimo di millimetro non è stampabile. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateSpine(input: SpineInput): SpineResult {
  const parsed = spineInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]!.message };
  }

  const { formula, factor, pageCount, coverThicknessMm } = parsed.data;

  let carta: number;
  let spiegazione: string;

  switch (formula) {
    case 'mm_per_page':
      carta = pageCount * factor;
      spiegazione = `${pageCount} pagine × ${factor} mm/pagina = ${round2(carta)} mm`;
      break;

    case 'pages_per_inch':
      carta = (pageCount / factor) * MM_PER_INCH;
      spiegazione = `${pageCount} pagine ÷ ${factor} PPI × ${MM_PER_INCH} = ${round2(carta)} mm`;
      break;

    case 'fixed':
      carta = factor;
      spiegazione = `Valore fisso: ${round2(carta)} mm`;
      break;
  }

  const totale = carta + coverThicknessMm;
  const breakdown =
    coverThicknessMm > 0
      ? `${spiegazione}, più ${coverThicknessMm} mm di cartone = ${round2(totale)} mm`
      : spiegazione;

  return { ok: true, spineMm: round2(totale), breakdown };
}

/**
 * Un dorso è considerato definitivo solo con il numero di pagine noto.
 * La funzione esiste per rendere esplicita, e verificabile, quella condizione.
 */
export function canLockSpine(pageCount: number | null, spineMm: number | null): boolean {
  return pageCount !== null && pageCount > 0 && spineMm !== null && spineMm > 0;
}

/**
 * Stima dello spessore per pagina a partire dalla grammatura, quando il
 * fornitore non pubblica il dato.
 *
 * È una STIMA: la mano della carta varia sensibilmente fra patinata, usomano e
 * riciclata. Va usata solo per un ordine di grandezza, mai per la stampa
 * definitiva.
 */
export function estimateMmPerPageFromGrammage(
  grammageGsm: number,
  bulk: 'liscia' | 'normale' | 'voluminosa' = 'normale',
): number {
  // Volume specifico approssimato in cm³/g.
  const volume = { liscia: 0.8, normale: 1.0, voluminosa: 1.3 }[bulk];
  // spessore(mm) = grammatura(g/m²) × volume(cm³/g) / 1000
  return round2((grammageGsm * volume) / 1000);
}
