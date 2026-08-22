import { z } from 'zod';

import {
  BRAND_FONT_STACK,
  BRAND_PALETTE,
  BRAND_SCRIM,
  COVER_BACKGROUND,
  COVER_TEXT_COLORS,
} from '@/lib/cover/brand';
import {
  escapeXml as esc,
  round2,
  svgText as text,
  wrapSvgText as wrapText,
} from '@/lib/cover/svg';

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

  return {
    totalWidthMm,
    totalHeightMm,
    trimBox,
    back,
    spine,
    front,
    backSafe: inset(back),
    frontSafe: inset(front),
    spineTooNarrowForText: s < MIN_SPINE_TEXT_MM,
  };
}

export interface CoverTexts {
  title: string;
  subtitle?: string | null;
  author: string;
  seriesName?: string | null;
  volumeLabel?: string | null;
  backDescription?: string | null;
  biography?: string | null;
  priceLabel?: string | null;
}

export interface CoverPreviewOptions {
  /**
   * Logo dello strumento oggetto dell'opera, caricato in fase di input.
   *
   * Viene composto, non generato: un marchio ridisegnato da un modello visuale
   * è un marchio sbagliato, e su una copertina stampata sarebbe un problema di
   * diritti prima ancora che di resa.
   */
  logoHref?: string | null;
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
  const sfondo = options.background ?? { ...COVER_BACKGROUND };

  const grafiche = options.artwork ?? {};

  const parti: string[] = [];

  parti.push(
    `<rect width="${layout.totalWidthMm}" height="${layout.totalHeightMm}" fill="${BRAND_PALETTE.inkDeep}"/>`,
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
  const centroFronte = f.x + f.width / 2;
  if (texts.seriesName) {
    parti.push(
      // Maiuscolo prima della neutralizzazione: `&amp;` reso maiuscolo
      // diventerebbe `&AMP;`, che non è più un'entità XML valida.
      text(centroFronte, f.y + 5, esc(texts.seriesName.toUpperCase()), {
        size: 3.2, weight: '600', fill: COVER_TEXT_COLORS.series, letterSpacing: 0.8, anchor: 'middle',
      }),
    );
  }
  parti.push(
    text(centroFronte, f.y + 13, esc(texts.author.toUpperCase()), {
      size: 5.2, weight: '700', fill: COVER_TEXT_COLORS.author, letterSpacing: 1.2, anchor: 'middle',
    }),
  );

  const righeTitolo = wrapText(
    esc(texts.title.toUpperCase()), centroFronte, f.y + 35, f.width * 0.86, {
      size: 13.5, weight: '800', fill: COVER_TEXT_COLORS.title,
      lineHeight: 14.5, maxLines: 3, anchor: 'middle',
    },
  );
  const dopoTitolo = f.y + 35 + (righeTitolo.length - 1) * 14.5;
  parti.push(
    ...righeTitolo,
  );
  let ySottotitolo = dopoTitolo + 10;
  if (texts.volumeLabel) {
    const badgeW = Math.min(58, Math.max(34, texts.volumeLabel.length * 4));
    parti.push(
      `<line x1="${round2(centroFronte - badgeW / 2 - 18)}" y1="${round2(dopoTitolo + 6)}" x2="${round2(centroFronte - badgeW / 2 - 4)}" y2="${round2(dopoTitolo + 6)}" stroke="${COVER_TEXT_COLORS.rule}" stroke-width="0.6"/>`,
      `<rect x="${round2(centroFronte - badgeW / 2)}" y="${round2(dopoTitolo + 0.5)}" width="${round2(badgeW)}" height="10" rx="5" fill="${BRAND_PALETTE.blue}"/>`,
      text(centroFronte, dopoTitolo + 7.4, esc(texts.volumeLabel.toUpperCase()), {
        size: 4.3, weight: '800', fill: BRAND_PALETTE.textPrimary, letterSpacing: 0.7, anchor: 'middle',
      }),
      `<line x1="${round2(centroFronte + badgeW / 2 + 4)}" y1="${round2(dopoTitolo + 6)}" x2="${round2(centroFronte + badgeW / 2 + 18)}" y2="${round2(dopoTitolo + 6)}" stroke="${COVER_TEXT_COLORS.rule}" stroke-width="0.6"/>`,
    );
    ySottotitolo = dopoTitolo + 18;
  }
  if (texts.subtitle) {
    parti.push(
      ...wrapText(esc(texts.subtitle), centroFronte, ySottotitolo, f.width * 0.92, {
        size: 4.4, weight: '600', fill: COVER_TEXT_COLORS.subtitle,
        lineHeight: 5.6, maxLines: 4, anchor: 'middle',
      }),
    );
  }
  parti.push(
    // Il logo sta in basso a destra, sulla stessa riga dell'autore: è il posto
    // in cui un lettore cerca «di che cosa parla», ed è fuori dalla zona in cui
    // cade il titolo.
    logo(f, options.logoHref),
  );

  // --- Dorso --------------------------------------------------------------
  if (!layout.spineTooNarrowForText) {
    const cx = layout.spine.x + layout.spine.width / 2;
    const cy = layout.spine.y + layout.spine.height / 2;
    parti.push(
      `<text x="${round2(cx)}" y="${round2(cy)}" transform="rotate(90 ${round2(cx)} ${round2(cy)})" ` +
        `font-family="${BRAND_FONT_STACK}" font-size="4" font-weight="600" fill="${COVER_TEXT_COLORS.title}" ` +
        `text-anchor="middle" dominant-baseline="middle">${esc(texts.title)} — ${esc(texts.author)}</text>`,
    );
  }

  // --- Quarta di copertina ------------------------------------------------
  const b = layout.backSafe;
  const centroRetro = b.x + b.width / 2;
  const titoloRetro = wrapText(esc(texts.title.toUpperCase()), centroRetro, b.y + 16, b.width * 0.86, {
    size: 10, weight: '800', fill: COVER_TEXT_COLORS.title,
    lineHeight: 10.5, maxLines: 3, anchor: 'middle',
  });
  parti.push(...titoloRetro);
  let cursore = b.y + 16 + titoloRetro.length * 10.5;
  if (texts.volumeLabel) {
    parti.push(text(centroRetro, cursore, esc(texts.volumeLabel.toUpperCase()), {
      size: 4, weight: '800', fill: COVER_TEXT_COLORS.heading, letterSpacing: 0.7, anchor: 'middle',
    }));
    cursore += 8;
  }
  if (texts.subtitle) {
    parti.push(...wrapText(esc(texts.subtitle.toUpperCase()), centroRetro, cursore, b.width, {
      size: 4.2, weight: '700', fill: COVER_TEXT_COLORS.heading,
      lineHeight: 5.2, maxLines: 3, anchor: 'middle',
    }));
    cursore += 18;
  }

  if (texts.backDescription) {
    const righe = wrapText(esc(texts.backDescription), centroRetro, cursore, b.width * 0.94, {
      size: 3.4, weight: '400', fill: COVER_TEXT_COLORS.body,
      lineHeight: 4.6, maxLines: 12, anchor: 'middle',
    });
    parti.push(...righe);
    cursore += righe.length * 4.6 + 6;
  }

  if (texts.biography) {
    parti.push(
      text(b.x, cursore, 'L’autore', { size: 3.4, weight: '700', fill: COVER_TEXT_COLORS.heading }),
      ...wrapText(esc(texts.biography), b.x, cursore + 5, b.width, {
        size: 3.1, weight: '400', fill: COVER_TEXT_COLORS.biography, lineHeight: 4.2, maxLines: 8,
      }),
    );
  }
  parti.push(logo(b, options.logoHref));

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
    `height="${round2(rect.height)}" fill="${BRAND_SCRIM}" opacity="${opacita}"/>`
  );
}

/**
 * Logo dello strumento, centrato in basso come elemento di chiusura.
 *
 * `meet` invece di `slice`: un marchio non si ritaglia. Se le proporzioni non
 * coincidono resta dello spazio, che è sempre preferibile a un logo tagliato.
 */
function logo(frontSafe: Rect, href: string | null | undefined): string {
  if (!href) return '';

  const altezza = Math.min(13, frontSafe.height * 0.07);
  const larghezza = Math.min(frontSafe.width * 0.46, altezza * 3.8);
  const x = round2(frontSafe.x + (frontSafe.width - larghezza) / 2);
  const y = round2(frontSafe.y + frontSafe.height - altezza - 1);

  return (
    `<image href="${esc(href)}" x="${x}" y="${y}" width="${round2(larghezza)}" ` +
    `height="${round2(altezza)}" preserveAspectRatio="xMidYMax meet"/>`
  );
}

function panel(rect: Rect, fill: string): string {
  return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${fill}"/>`;
}

