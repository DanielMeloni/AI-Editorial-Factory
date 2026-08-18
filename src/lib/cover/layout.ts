import { z } from 'zod';

/**
 * Geometria della copertina completa, stesa in piano.
 *
 * L'ordine dei pannelli è quello del foglio di stampa:
 *
 *     [ quarta di copertina ][ dorso ][ fronte ]
 *
 * Le misure sono in millimetri. L'abbondanza (bleed) è la fascia che eccede il
 * taglio e viene rifilata: il fondo deve arrivarci, altrimenti un errore di
 * taglio di mezzo millimetro lascia una riga bianca sul bordo. Il margine di
 * sicurezza è la distanza minima entro cui non collocare testo.
 */

export const coverGeometrySchema = z.object({
  trimWidthMm: z.number().positive(),
  trimHeightMm: z.number().positive(),
  spineMm: z.number().min(0),
  bleedMm: z.number().min(0).default(3),
  safetyMarginMm: z.number().min(0).default(5),
});

export type CoverGeometry = z.infer<typeof coverGeometrySchema>;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CoverLayout {
  /** Dimensioni del foglio, abbondanza compresa. */
  totalWidthMm: number;
  totalHeightMm: number;
  /** Area rifilata, senza abbondanza. */
  trimBox: Rect;
  back: Rect;
  spine: Rect;
  front: Rect;
  /** Aree entro cui il testo è al sicuro dal taglio. */
  backSafe: Rect;
  frontSafe: Rect;
  /** Riquadro consigliato per il codice a barre, in basso a destra sulla quarta. */
  barcodeBox: Rect;
  /** Vero se il dorso è troppo stretto per ospitare del testo leggibile. */
  spineTooNarrowForText: boolean;
}

/** Sotto questa larghezza il testo sul dorso non è leggibile e va omesso. */
export const MIN_SPINE_TEXT_MM = 6;

export function computeCoverLayout(geometry: CoverGeometry): CoverLayout {
  const g = coverGeometrySchema.parse(geometry);
  const { trimWidthMm: w, trimHeightMm: h, spineMm: s, bleedMm: bleed, safetyMarginMm: safe } = g;

  const totalWidthMm = round2(w * 2 + s + bleed * 2);
  const totalHeightMm = round2(h + bleed * 2);

  const trimBox: Rect = { x: bleed, y: bleed, width: round2(w * 2 + s), height: h };

  const back: Rect = { x: bleed, y: bleed, width: w, height: h };
  const spine: Rect = { x: round2(bleed + w), y: bleed, width: s, height: h };
  const front: Rect = { x: round2(bleed + w + s), y: bleed, width: w, height: h };

  const inset = (rect: Rect): Rect => ({
    x: round2(rect.x + safe),
    y: round2(rect.y + safe),
    width: round2(rect.width - safe * 2),
    height: round2(rect.height - safe * 2),
  });

  // Il codice a barre sta in basso a destra sulla quarta, dentro il margine
  // di sicurezza: è la collocazione che i distributori si aspettano.
  const barcodeWidth = Math.min(40, w - safe * 2);
  const barcodeHeight = Math.min(25, h / 4);
  const barcodeBox: Rect = {
    x: round2(back.x + back.width - safe - barcodeWidth),
    y: round2(back.y + back.height - safe - barcodeHeight),
    width: round2(barcodeWidth),
    height: round2(barcodeHeight),
  };

  return {
    totalWidthMm,
    totalHeightMm,
    trimBox,
    back,
    spine,
    front,
    backSafe: inset(back),
    frontSafe: inset(front),
    barcodeBox,
    spineTooNarrowForText: s < MIN_SPINE_TEXT_MM,
  };
}

export interface CoverTexts {
  title: string;
  subtitle?: string | null;
  author: string;
  seriesName?: string | null;
  backDescription?: string | null;
  biography?: string | null;
  priceLabel?: string | null;
}

export interface CoverPreviewOptions {
  /** SVG del codice a barre, già generato. */
  barcodeSvg?: string | null;
  /** Mostra le linee guida di taglio e sicurezza. */
  showGuides?: boolean;
  /** Colori di fondo dei pannelli, usati dove non c'è un'immagine. */
  background?: { front: string; back: string; spine: string };
  /**
   * Grafiche approvate o in prova, un indirizzo per pannello.
   *
   * Vengono disegnate sotto la tipografia e ritagliate sul pannello, mai
   * deformate: una copertina schiacciata mostrerebbe una proporzione che in
   * stampa non esisterà.
   */
  artwork?: { front?: string | null; spine?: string | null; back?: string | null };
}

/**
 * Anteprima della copertina distesa.
 *
 * Titolo, autore, sottotitolo, collana, ISBN e codice a barre sono aggiunti
 * **programmaticamente**, non generati da un modello: solo così la resa è
 * leggibile, la posizione è controllata e il testo resta selezionabile e
 * verificabile.
 */
export function buildCoverPreviewSvg(
  layout: CoverLayout,
  texts: CoverTexts,
  options: CoverPreviewOptions = {},
): string {
  const guides = options.showGuides ?? true;
  const sfondo = options.background ?? {
    front: '#16233d',
    back: '#1d2f4f',
    spine: '#101a2e',
  };

  const grafiche = options.artwork ?? {};

  const parti: string[] = [];

  parti.push(
    `<rect width="${layout.totalWidthMm}" height="${layout.totalHeightMm}" fill="#e9edf3"/>`,
    panel(layout.back, sfondo.back),
    panel(layout.spine, sfondo.spine),
    panel(layout.front, sfondo.front),
  );

  // Le immagini stanno sotto: il testo è tipografia e deve restare sopra,
  // leggibile. La velatura non è un effetto estetico — senza, l'anteprima
  // prometterebbe una leggibilità che su una grafica chiara non ci sarebbe.
  parti.push(
    image(layout.back, grafiche.back, 'quarta'),
    image(layout.spine, grafiche.spine, 'dorso'),
    image(layout.front, grafiche.front, 'fronte'),
    velatura(layout.back, grafiche.back, 0.55),
    velatura(layout.spine, grafiche.spine, 0.45),
    velatura(layout.front, grafiche.front, 0.4),
  );

  // --- Fronte -------------------------------------------------------------
  const f = layout.frontSafe;
  if (texts.seriesName) {
    parti.push(
      text(f.x, f.y + 6, esc(texts.seriesName), {
        size: 3.6, weight: '600', fill: '#8fb3ff', letterSpacing: 0.6,
      }),
    );
  }
  parti.push(
    ...wrapText(esc(texts.title), f.x, f.y + f.height * 0.32, f.width, {
      size: 9, weight: '700', fill: '#ffffff', lineHeight: 11,
    }),
  );
  if (texts.subtitle) {
    parti.push(
      ...wrapText(esc(texts.subtitle), f.x, f.y + f.height * 0.32 + 16, f.width, {
        size: 4.6, weight: '400', fill: '#c8d6f0', lineHeight: 6,
      }),
    );
  }
  parti.push(
    text(f.x, f.y + f.height - 2, esc(texts.author), { size: 5.2, weight: '600', fill: '#ffffff' }),
  );

  // --- Dorso --------------------------------------------------------------
  if (!layout.spineTooNarrowForText) {
    const cx = layout.spine.x + layout.spine.width / 2;
    const cy = layout.spine.y + layout.spine.height / 2;
    parti.push(
      `<text x="${round2(cx)}" y="${round2(cy)}" transform="rotate(90 ${round2(cx)} ${round2(cy)})" ` +
        `font-family="system-ui, sans-serif" font-size="4" font-weight="600" fill="#ffffff" ` +
        `text-anchor="middle" dominant-baseline="middle">${esc(texts.title)} — ${esc(texts.author)}</text>`,
    );
  }

  // --- Quarta di copertina ------------------------------------------------
  const b = layout.backSafe;
  let cursore = b.y + 8;

  if (texts.backDescription) {
    const righe = wrapText(esc(texts.backDescription), b.x, cursore, b.width, {
      size: 3.4, weight: '400', fill: '#dfe7f5', lineHeight: 4.6, maxLines: 14,
    });
    parti.push(...righe);
    cursore += righe.length * 4.6 + 6;
  }

  if (texts.biography) {
    parti.push(
      text(b.x, cursore, 'L’autore', { size: 3.4, weight: '700', fill: '#8fb3ff' }),
      ...wrapText(esc(texts.biography), b.x, cursore + 5, b.width, {
        size: 3.1, weight: '400', fill: '#c8d6f0', lineHeight: 4.2, maxLines: 8,
      }),
    );
  }

  // --- Codice a barre -----------------------------------------------------
  if (options.barcodeSvg) {
    const inner = options.barcodeSvg
      .replace(/^<svg[^>]*>/, '')
      .replace(/<\/svg>$/, '');
    const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(options.barcodeSvg);
    const bw = viewBox ? Number(viewBox[1]) : layout.barcodeBox.width;
    const bh = viewBox ? Number(viewBox[2]) : layout.barcodeBox.height;
    const scala = Math.min(layout.barcodeBox.width / bw, layout.barcodeBox.height / bh);

    // L'elemento <svg> esterno viene rimosso per non annidare due radici: con
    // esso andrebbe persa anche l'etichetta accessibile, che va quindi
    // ricostruita sul gruppo.
    const etichetta = /aria-label="([^"]*)"/.exec(options.barcodeSvg)?.[1] ?? 'Codice a barre ISBN';

    parti.push(
      `<g role="img" aria-label="${etichetta}" ` +
        `transform="translate(${layout.barcodeBox.x} ${layout.barcodeBox.y}) scale(${round3(scala)})">` +
        `<title>${etichetta}</title>` +
        `<rect x="-2" y="-2" width="${round2(bw + 4)}" height="${round2(bh + 4)}" fill="#ffffff" rx="1"/>` +
        inner +
        '</g>',
    );
  }

  // --- Guide di stampa ----------------------------------------------------
  if (guides) {
    parti.push(
      `<rect x="${layout.trimBox.x}" y="${layout.trimBox.y}" width="${layout.trimBox.width}" height="${layout.trimBox.height}" ` +
        `fill="none" stroke="#ff3b30" stroke-width="0.3" stroke-dasharray="2 1.5"/>`,
      `<rect x="${layout.backSafe.x}" y="${layout.backSafe.y}" width="${layout.backSafe.width}" height="${layout.backSafe.height}" ` +
        `fill="none" stroke="#00c48c" stroke-width="0.2" stroke-dasharray="1 1"/>`,
      `<rect x="${layout.frontSafe.x}" y="${layout.frontSafe.y}" width="${layout.frontSafe.width}" height="${layout.frontSafe.height}" ` +
        `fill="none" stroke="#00c48c" stroke-width="0.2" stroke-dasharray="1 1"/>`,
      `<line x1="${layout.spine.x}" y1="${layout.trimBox.y}" x2="${layout.spine.x}" y2="${round2(layout.trimBox.y + layout.trimBox.height)}" stroke="#ffb300" stroke-width="0.25"/>`,
      `<line x1="${round2(layout.spine.x + layout.spine.width)}" y1="${layout.trimBox.y}" x2="${round2(layout.spine.x + layout.spine.width)}" y2="${round2(layout.trimBox.y + layout.trimBox.height)}" stroke="#ffb300" stroke-width="0.25"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.totalWidthMm} ${layout.totalHeightMm}" ` +
    `width="100%" role="img" aria-label="Anteprima della copertina: quarta di copertina, dorso e fronte">` +
    parti.join('') +
    '</svg>'
  );
}

// ---------------------------------------------------------------------------

/**
 * Immagine ritagliata sul pannello.
 *
 * `slice` riempie il riquadro conservando le proporzioni e tagliando ciò che
 * eccede: è quello che farà la stampa, e l'anteprima deve dire la verità su
 * quanto andrà perso.
 */
function image(rect: Rect, href: string | null | undefined, nome: string): string {
  if (!href) return '';
  const id = `ritaglio-${nome}`;
  return (
    `<clipPath id="${id}"><rect x="${round2(rect.x)}" y="${round2(rect.y)}" ` +
    `width="${round2(rect.width)}" height="${round2(rect.height)}"/></clipPath>` +
    `<image href="${esc(href)}" x="${round2(rect.x)}" y="${round2(rect.y)}" ` +
    `width="${round2(rect.width)}" height="${round2(rect.height)}" ` +
    `preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
  );
}

/** Velo scuro sopra l'immagine: è ciò che tiene leggibile il testo bianco. */
function velatura(rect: Rect, href: string | null | undefined, opacita: number): string {
  if (!href) return '';
  return (
    `<rect x="${round2(rect.x)}" y="${round2(rect.y)}" width="${round2(rect.width)}" ` +
    `height="${round2(rect.height)}" fill="#0b1220" opacity="${opacita}"/>`
  );
}

function panel(rect: Rect, fill: string): string {
  return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${fill}"/>`;
}

interface TextStyle {
  size: number;
  weight: string;
  fill: string;
  letterSpacing?: number;
  lineHeight?: number;
  maxLines?: number;
}

function text(x: number, y: number, content: string, style: TextStyle): string {
  return (
    `<text x="${round2(x)}" y="${round2(y)}" font-family="system-ui, sans-serif" ` +
    `font-size="${style.size}" font-weight="${style.weight}" fill="${style.fill}"` +
    (style.letterSpacing ? ` letter-spacing="${style.letterSpacing}"` : '') +
    `>${content}</text>`
  );
}

/**
 * Manda a capo il testo stimando la larghezza dei caratteri.
 * È una stima: senza metriche del font non esiste un calcolo esatto, e per
 * un'anteprima è sufficiente.
 */
function wrapText(content: string, x: number, y: number, width: number, style: TextStyle): string[] {
  const larghezzaCarattere = style.size * 0.52;
  const perRiga = Math.max(1, Math.floor(width / larghezzaCarattere));
  const lineHeight = style.lineHeight ?? style.size * 1.25;

  const parole = content.split(/\s+/);
  const righe: string[] = [];
  let corrente = '';

  for (const parola of parole) {
    const tentativo = corrente ? `${corrente} ${parola}` : parola;
    if (tentativo.length <= perRiga) {
      corrente = tentativo;
    } else {
      if (corrente) righe.push(corrente);
      corrente = parola;
    }
  }
  if (corrente) righe.push(corrente);

  const limite = style.maxLines ?? righe.length;
  const visibili = righe.slice(0, limite);
  if (righe.length > limite && visibili.length > 0) {
    visibili[visibili.length - 1] = `${visibili[visibili.length - 1]!.slice(0, -1)}…`;
  }

  return visibili.map((riga, index) => text(x, y + index * lineHeight, riga, style));
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
