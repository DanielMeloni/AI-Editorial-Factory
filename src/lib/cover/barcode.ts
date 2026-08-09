/**
 * Codice a barre EAN-13 per l'ISBN, generato come SVG.
 *
 * Il codice a barre non viene mai prodotto da un modello visuale: deve essere
 * leggibile da uno scanner, e questo richiede larghezze di barra esatte. Qui è
 * costruito dalla specifica EAN-13, cifra per cifra.
 */

export type BarcodeResult =
  | { ok: true; svg: string; isbn13: string; checkDigit: number; widthMm: number; heightMm: number }
  | { ok: false; reason: string };

// Codifiche EAN-13: tre insiemi di sette moduli per cifra.
const SET_A = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const SET_B = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const SET_C = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];

// La prima cifra non è codificata: determina l'alternanza A/B nella metà sinistra.
const PARITY = [
  'AAAAAA', 'AABABB', 'AABBAB', 'AABBBA', 'ABAABB',
  'ABBAAB', 'ABBBAA', 'ABABAB', 'ABABBA', 'ABBABA',
];

/** Cifra di controllo EAN-13: pesi alternati 1 e 3 sulle prime dodici cifre. */
export function ean13CheckDigit(twelveDigits: string): number {
  let somma = 0;
  for (let i = 0; i < 12; i += 1) {
    const cifra = Number(twelveDigits[i]);
    somma += i % 2 === 0 ? cifra : cifra * 3;
  }
  return (10 - (somma % 10)) % 10;
}

/** Normalizza un ISBN togliendo trattini e spazi. */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** Converte un ISBN-10 in ISBN-13 anteponendo il prefisso 978. */
export function isbn10To13(isbn10: string): string | null {
  const pulito = normalizeIsbn(isbn10);
  if (!/^\d{9}[\dX]$/.test(pulito)) return null;
  const base = `978${pulito.slice(0, 9)}`;
  return `${base}${ean13CheckDigit(base)}`;
}

export function toIsbn13(raw: string): string | null {
  const pulito = normalizeIsbn(raw);
  if (/^\d{13}$/.test(pulito)) {
    // La cifra di controllo dichiarata deve coincidere con quella calcolata.
    return ean13CheckDigit(pulito.slice(0, 12)) === Number(pulito[12]) ? pulito : null;
  }
  if (/^\d{9}[\dX]$/.test(pulito)) return isbn10To13(pulito);
  return null;
}

export interface BarcodeOptions {
  /** Larghezza di un singolo modulo, in millimetri. Lo standard è 0,33 mm. */
  moduleWidthMm?: number;
  /** Altezza delle barre, esclusa la riga di cifre. */
  barHeightMm?: number;
  /** Mostra il prezzo sopra il codice, come add-on testuale. */
  priceLabel?: string | null;
}

/**
 * Costruisce l'SVG del codice a barre.
 * Restituisce un errore esplicito se l'ISBN non è valido: un codice a barre
 * sbagliato stampato su diecimila copie non si corregge.
 */
export function buildIsbnBarcode(rawIsbn: string, options: BarcodeOptions = {}): BarcodeResult {
  const isbn13 = toIsbn13(rawIsbn);
  if (!isbn13) {
    return {
      ok: false,
      reason:
        'ISBN non valido: attesi 13 cifre con cifra di controllo corretta, oppure un ISBN-10 convertibile.',
    };
  }

  const moduleWidth = options.moduleWidthMm ?? 0.33;
  const barHeight = options.barHeightMm ?? 22.85;

  const prima = Number(isbn13[0]);
  const sinistra = isbn13.slice(1, 7);
  const destra = isbn13.slice(7);
  const parita = PARITY[prima]!;

  // 3 (guardia) + 42 (sinistra) + 5 (centrale) + 42 (destra) + 3 (guardia)
  let pattern = '101';
  for (let i = 0; i < 6; i += 1) {
    const cifra = Number(sinistra[i]);
    pattern += parita[i] === 'A' ? SET_A[cifra]! : SET_B[cifra]!;
  }
  pattern += '01010';
  for (const carattere of destra) pattern += SET_C[Number(carattere)]!;
  pattern += '101';

  const quietLeft = 11 * moduleWidth;
  const quietRight = 7 * moduleWidth;
  const larghezzaCodice = pattern.length * moduleWidth;
  const larghezzaTotale = quietLeft + larghezzaCodice + quietRight;
  const altezzaTotale = barHeight + (options.priceLabel ? 8 : 4);

  // Le barre di guardia scendono sotto le altre, come da specifica.
  const guardIndexes = new Set<number>();
  for (const start of [0, 45, 50, 92]) {
    for (let i = start; i < start + 3; i += 1) guardIndexes.add(i);
  }
  for (let i = 45; i < 50; i += 1) guardIndexes.add(i);

  const barre: string[] = [];
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] !== '1') continue;
    const estesa = guardIndexes.has(i);
    barre.push(
      `<rect x="${round3(quietLeft + i * moduleWidth)}" y="${options.priceLabel ? 4 : 0}" ` +
        `width="${round3(moduleWidth)}" height="${round3(barHeight + (estesa ? 1.65 : 0))}" fill="#000"/>`,
    );
  }

  const baseTesto = (options.priceLabel ? 4 : 0) + barHeight + 3.3;
  const testo: string[] = [
    `<text x="${round3(quietLeft - 1.5)}" y="${round3(baseTesto)}" font-family="OCRB, monospace" font-size="3" text-anchor="end" fill="#000">${isbn13[0]}</text>`,
    `<text x="${round3(quietLeft + 24 * moduleWidth)}" y="${round3(baseTesto)}" font-family="OCRB, monospace" font-size="3" text-anchor="middle" fill="#000" letter-spacing="0.8">${sinistra}</text>`,
    `<text x="${round3(quietLeft + 71 * moduleWidth)}" y="${round3(baseTesto)}" font-family="OCRB, monospace" font-size="3" text-anchor="middle" fill="#000" letter-spacing="0.8">${destra}</text>`,
  ];

  if (options.priceLabel) {
    testo.unshift(
      `<text x="${round3(larghezzaTotale / 2)}" y="3" font-family="OCRB, monospace" font-size="3" text-anchor="middle" fill="#000">${escapeXml(options.priceLabel)}</text>`,
    );
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round3(larghezzaTotale)}mm" height="${round3(altezzaTotale)}mm" ` +
    `viewBox="0 0 ${round3(larghezzaTotale)} ${round3(altezzaTotale)}" role="img" ` +
    `aria-label="Codice a barre ISBN ${isbn13}">` +
    `<rect width="${round3(larghezzaTotale)}" height="${round3(altezzaTotale)}" fill="#fff"/>` +
    barre.join('') +
    testo.join('') +
    '</svg>';

  return {
    ok: true,
    svg,
    isbn13,
    checkDigit: Number(isbn13[12]),
    widthMm: round3(larghezzaTotale),
    heightMm: round3(altezzaTotale),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
