/**
 * Stima delle pagine a partire dal conteggio delle parole.
 *
 * La stima nasce da una densità unica — parole per centimetro quadrato di
 * specchio di stampa — applicata all'area utile di ciascun formato. Un solo
 * numero da tarare, e i formati restano confrontabili fra loro: se la densità
 * è imprecisa lo è allo stesso modo su A4, A5 e formato libro, e il rapporto
 * fra i tre resta vero.
 *
 * Quel che la stima **non** sa: figure, blocchi di codice e spazi bianchi
 * occupano pagina senza portare parole. Su un manuale tecnico il conto reale è
 * quindi sempre maggiore di questo, mai minore. Va letto come un minimo, e
 * l'interfaccia lo dichiara.
 */

/** Parole per centimetro quadrato di specchio, corpo 11 su interlinea normale. */
const DENSITA_PAROLE_CM2 = 1.27;

export interface FormatoStampa {
  key: 'a4' | 'a5' | 'libro';
  label: string;
  /** Misure del foglio rifilato, in millimetri. */
  widthMm: number;
  heightMm: number;
  /** Margine perimetrale medio, in millimetri. */
  marginMm: number;
}

export const FORMATI: FormatoStampa[] = [
  { key: 'a4', label: 'A4', widthMm: 210, heightMm: 297, marginMm: 25 },
  { key: 'a5', label: 'A5', widthMm: 148, heightMm: 210, marginMm: 18 },
  { key: 'libro', label: 'Libro', widthMm: 170, heightMm: 240, marginMm: 20 },
];

export type FormatoKey = FormatoStampa['key'];

/** Parole che entrano in una pagina del formato indicato. */
export function parolePerPagina(formato: FormatoStampa): number {
  const larghezzaUtileCm = (formato.widthMm - formato.marginMm * 2) / 10;
  const altezzaUtileCm = (formato.heightMm - formato.marginMm * 2) / 10;
  const areaCm2 = Math.max(larghezzaUtileCm * altezzaUtileCm, 1);
  return Math.max(Math.round(areaCm2 * DENSITA_PAROLE_CM2), 1);
}

/**
 * Pagine stimate per un conteggio di parole.
 *
 * Un capitolo che esiste occupa almeno una pagina: zero pagine per del testo
 * scritto sarebbe una risposta sbagliata, non una risposta prudente.
 */
export function pagineStimate(words: number, formato: FormatoStampa): number {
  if (words <= 0) return 0;
  return Math.max(Math.ceil(words / parolePerPagina(formato)), 1);
}

/** Il formato del libro secondo le specifiche salvate, se ci sono. */
export function formatoLibro(trim: { widthMm: number; heightMm: number } | null): FormatoStampa {
  const predefinito = FORMATI.find((formato) => formato.key === 'libro')!;
  if (!trim || trim.widthMm <= 0 || trim.heightMm <= 0) return predefinito;
  return { ...predefinito, widthMm: trim.widthMm, heightMm: trim.heightMm };
}
