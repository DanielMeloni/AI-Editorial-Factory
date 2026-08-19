import { BRAND_PALETTE, COVER_TEXT_COLORS } from '@/lib/cover/brand';
import { escapeXml as esc, round2, svgText as text, wrapSvgText as wrapText } from '@/lib/cover/svg';

/**
 * Anteprima di un corso: la copertina del corso, in sedici noni.
 *
 * È costruita dal codice, non da un modello visuale, per la stessa ragione per
 * cui lo sono i diagrammi: il titolo di un corso e il numero di lezioni sono
 * **dati**, e un'immagine generata li scriverebbe storti e non correggibili.
 * Qui il testo resta testo, la palette è quella della collana, e la stessa
 * scaletta produce sempre la stessa immagine — utile quando la si rigenera
 * dopo aver corretto una virgola nel titolo.
 */

export interface CoursePreviewInput {
  title: string;
  level: 'base' | 'intermediate' | 'advanced';
  format: 'autoapprendimento' | 'aula' | 'video';
  lessonCount: number;
  lessonMinutes: number;
  author?: string | null;
  seriesName?: string | null;
  /** Logo dello strumento, composto in basso a destra come sulla copertina. */
  logoHref?: string | null;
}

const LIVELLO: Record<CoursePreviewInput['level'], string> = {
  base: 'Base',
  intermediate: 'Intermedio',
  advanced: 'Avanzato',
};

const FORMATO: Record<CoursePreviewInput['format'], string> = {
  autoapprendimento: 'Autoapprendimento',
  aula: 'Aula',
  video: 'Video',
};

/** Sedici noni: è il rapporto che ogni piattaforma di corsi si aspetta. */
export const COURSE_PREVIEW_WIDTH = 1280;
export const COURSE_PREVIEW_HEIGHT = 720;

export function buildCoursePreviewSvg(input: CoursePreviewInput): string {
  const W = COURSE_PREVIEW_WIDTH;
  const H = COURSE_PREVIEW_HEIGHT;
  const margine = 88;
  const larghezzaTesto = W - margine * 2 - 220;

  // Gli identificatori dipendono dal titolo: due anteprime nella stessa pagina
  // non devono condividere una sfumatura, o la seconda erediterebbe la prima.
  const id = impronta(input.title);

  const occhiello = [
    'Corso',
    LIVELLO[input.level],
    FORMATO[input.format],
    input.seriesName ?? null,
  ]
    .filter(Boolean)
    .join(' · ')
    .toUpperCase();

  const durata =
    `${input.lessonCount} lezion${input.lessonCount === 1 ? 'e' : 'i'} · ` +
    `${input.lessonMinutes} minuti l’una`;

  const righeTitolo = wrapText(esc(input.title), margine, 372, larghezzaTesto, {
    size: 62,
    weight: '700',
    fill: COVER_TEXT_COLORS.title,
    lineHeight: 74,
    maxLines: 3,
  });

  const parti: string[] = [
    `<defs>` +
      `<linearGradient id="fondo-${id}" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="${BRAND_PALETTE.navy}"/>` +
      `<stop offset="60%" stop-color="${BRAND_PALETTE.ink}"/>` +
      `<stop offset="100%" stop-color="${BRAND_PALETTE.inkDeep}"/>` +
      `</linearGradient>` +
      `<radialGradient id="luce-${id}" cx="0.82" cy="0.3" r="0.55">` +
      `<stop offset="0%" stop-color="${BRAND_PALETTE.blue}" stop-opacity="0.42"/>` +
      `<stop offset="100%" stop-color="${BRAND_PALETTE.blue}" stop-opacity="0"/>` +
      `</radialGradient>` +
      `<pattern id="reticolo-${id}" width="32" height="32" patternUnits="userSpaceOnUse">` +
      `<circle cx="1.5" cy="1.5" r="1.5" fill="${BRAND_PALETTE.hairline}" fill-opacity="0.55"/>` +
      `</pattern>` +
      `</defs>`,

    `<rect width="${W}" height="${H}" fill="url(#fondo-${id})"/>`,
    `<rect width="${W}" height="${H}" fill="url(#reticolo-${id})"/>`,
    `<rect width="${W}" height="${H}" fill="url(#luce-${id})"/>`,

    // L'esagono è il segno del marchio: qui resta un contorno, lontano dal
    // testo, e non compete con il titolo.
    esagono(W - 250, 300, 190, BRAND_PALETTE.blue, 0.5),
    esagono(W - 250, 300, 128, BRAND_PALETTE.cyan, 0.32),

    // Filetto e occhiello: gli stessi del fronte di copertina, in scala.
    `<rect x="${margine}" y="252" width="150" height="5" fill="${COVER_TEXT_COLORS.rule}"/>`,
    text(margine, 224, esc(occhiello), {
      size: 24,
      weight: '600',
      fill: COVER_TEXT_COLORS.series,
      letterSpacing: 4,
    }),

    ...righeTitolo,

    text(margine, 372 + righeTitolo.length * 74 + 26, esc(durata), {
      size: 28,
      weight: '400',
      fill: COVER_TEXT_COLORS.body,
    }),
  ];

  if (input.author) {
    parti.push(
      text(margine, H - 64, esc(input.author), {
        size: 26,
        weight: '600',
        fill: COVER_TEXT_COLORS.author,
      }),
    );
  }

  if (input.logoHref) {
    const altezza = 64;
    const larghezza = 220;
    parti.push(
      `<image href="${esc(input.logoHref)}" x="${round2(W - margine - larghezza)}" ` +
        `y="${round2(H - 64 - altezza + 18)}" width="${larghezza}" height="${altezza}" ` +
        `preserveAspectRatio="xMaxYMax meet"/>`,
    );
  }

  const descrizione = esc(
    `Anteprima del corso «${input.title}», livello ${LIVELLO[input.level].toLowerCase()}, ` +
      `formato ${FORMATO[input.format].toLowerCase()}, ${durata.replace(/·/g, 'e')}.`,
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" ` +
    `role="img" aria-label="${descrizione}"><title>${descrizione}</title>` +
    parti.join('') +
    '</svg>'
  );
}

/** Esagono con la punta in alto, come quello del marchio. */
function esagono(cx: number, cy: number, r: number, stroke: string, opacity: number): string {
  const punti = Array.from({ length: 6 }, (_, i) => {
    const angolo = (Math.PI / 180) * (60 * i - 90);
    return `${round2(cx + r * Math.cos(angolo))},${round2(cy + r * Math.sin(angolo))}`;
  }).join(' ');

  return (
    `<polygon points="${punti}" fill="none" stroke="${stroke}" stroke-width="2" ` +
    `stroke-opacity="${opacity}"/>`
  );
}

/**
 * Impronta stabile del titolo, per gli identificatori interni all'SVG.
 *
 * Non è una funzione crittografica e non deve esserlo: serve solo a non far
 * collidere due sfumature nella stessa pagina, e a restare identica fra due
 * generazioni dello stesso corso.
 */
function impronta(valore: string): string {
  let h = 2166136261;
  for (let i = 0; i < valore.length; i += 1) {
    h ^= valore.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
