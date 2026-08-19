/**
 * Identità visiva delle copertine e delle anteprime.
 *
 * È ricavata dal sito dell'autore — danielmeloni.com — e sta in un solo posto
 * perché copertine e anteprime dei corsi devono somigliarsi fra loro **e** al
 * sito: sono la stessa collana vista da tre finestre diverse. Cambiare il blu
 * qui lo cambia ovunque; scriverlo tre volte lo farebbe divergere alla prima
 * modifica.
 *
 * Il registro del sito, in breve: fondo blu notte quasi nero, un soggetto
 * tecnico illuminato da dentro con blu elettrico e ciano, geometrie pulite —
 * esagoni, nodi, linee di circuito — e nessuna concessione decorativa.
 */

/**
 * I colori, in esadecimale.
 *
 * Non in oklch come i token dell'interfaccia: qui finiscono dentro un SVG che
 * può essere convertito in PDF di stampa, e l'esadecimale è ciò che ogni
 * strumento della catena legge senza discutere.
 */
export const BRAND_PALETTE = {
  /** Fondo più profondo: dorso e zone di riposo. */
  inkDeep: '#04070f',
  /** Fondo della quarta: scuro ma non nero, per non spegnere il testo. */
  ink: '#070d1b',
  /** Fondo del fronte: blu notte del sito. */
  navy: '#0a1730',
  /** Superficie rialzata, per riquadri e plinti. */
  navyRaised: '#0f2547',
  /** Filo di luce: bordi, righelli, separatori. */
  hairline: '#1b3b6b',
  /** Blu elettrico: l'accento primario, quello dei pulsanti del sito. */
  blue: '#2f7df6',
  /** Blu chiaro: titoli in evidenza, «soluzioni utili». */
  blueBright: '#5aa2ff',
  /** Ciano: accenti puntuali, luci del logo. */
  cyan: '#22d3ee',
  textPrimary: '#ffffff',
  textSecondary: '#c9d8f0',
  textMuted: '#8ea7c8',
} as const;

export type BrandPalette = typeof BRAND_PALETTE;

/** Fondi dei tre pannelli, usati dove non c'è ancora un'immagine. */
export const COVER_BACKGROUND = {
  front: BRAND_PALETTE.navy,
  spine: BRAND_PALETTE.inkDeep,
  back: BRAND_PALETTE.ink,
} as const;

/** Colori della tipografia composta sopra le immagini. */
export const COVER_TEXT_COLORS = {
  series: BRAND_PALETTE.blueBright,
  title: BRAND_PALETTE.textPrimary,
  subtitle: BRAND_PALETTE.textSecondary,
  author: BRAND_PALETTE.textPrimary,
  body: BRAND_PALETTE.textSecondary,
  heading: BRAND_PALETTE.blueBright,
  biography: BRAND_PALETTE.textMuted,
  rule: BRAND_PALETTE.blue,
} as const;

/**
 * La pila tipografica.
 *
 * Il sito usa una grottesca geometrica; in un SVG che deve aprirsi ovunque —
 * browser, anteprima, convertitore PDF — un font non installato non è un
 * ripiego elegante ma un testo che cambia larghezza e va fuori dal margine.
 * Si resta quindi sui font di sistema, e la somiglianza la fanno colore,
 * spaziatura e peso.
 */
export const BRAND_FONT_STACK = "system-ui, 'Segoe UI', Roboto, sans-serif";

/** Velo scuro sopra le immagini: è ciò che tiene leggibile il testo bianco. */
export const BRAND_SCRIM = BRAND_PALETTE.inkDeep;

/**
 * La direzione visuale, in parole.
 *
 * Va dentro al prompt di ogni immagine — copertine e anteprime dei corsi — e
 * descrive il registro del sito senza nominarlo: un modello non può visitarlo.
 */
export const BRAND_ART_DIRECTION = [
  'Illustrazione digitale tecnica su fondo blu notte quasi nero.',
  'Soggetto isometrico dalle geometrie pulite — esagoni, nodi collegati, piani sovrapposti,',
  'linee di circuito sottili, reticoli di punti — illuminato da dentro con blu elettrico e ciano.',
  'Luce fredda e direzionale, bagliore che si spegne nel fondo, ampie superfici scure e uniformi.',
  'Nitido, sobrio, professionale: lo strumento di lavoro di un ingegnere dei dati, non fantascienza.',
].join(' ');

/** La gamma cromatica, dichiarata al modello con i valori esatti. */
export const BRAND_PALETTE_PROMPT =
  `Palette obbligatoria: fondi ${BRAND_PALETTE.ink} e ${BRAND_PALETTE.navy}, ` +
  `luci blu elettrico ${BRAND_PALETTE.blue} e ${BRAND_PALETTE.blueBright}, ` +
  `accenti ciano ${BRAND_PALETTE.cyan}. Nessun altro colore dominante.`;

/**
 * Ciò che non deve comparire.
 *
 * Il testo è escluso per costruzione, non per gusto: titolo, autore e collana
 * sono composti sopra l'immagine, e una parola generata dentro di essa
 * resterebbe lì, storta e non correggibile, sotto la tipografia vera.
 */
export const BRAND_NEGATIVE_PROMPT = [
  'testo, lettere, numeri, titoli, didascalie, filigrane',
  'loghi, marchi e simboli aziendali riconoscibili',
  'volti, persone, mani',
  'fondo bianco o chiaro',
  'colori caldi dominanti (arancione, rosso, giallo)',
  'stile fumetto, acquerello, schizzo a mano',
  'composizioni affollate, elementi tagliati ai bordi',
].join(', ');

/**
 * La direzione visuale completa, con il posto dello strumento.
 *
 * Il logo caricato in fase di input non viene ridisegnato: entra come
 * indicazione di soggetto e di colore, mentre il marchio vero viene composto
 * programmaticamente sulla copertina. Un logo ridisegnato da un modello è un
 * logo sbagliato — e su una copertina stampata sarebbe anche un problema di
 * marchio, non solo di gusto.
 */
export function brandArtDirection(options: {
  toolName?: string | null;
  hasLogo?: boolean;
} = {}): string {
  const parti = [BRAND_ART_DIRECTION, BRAND_PALETTE_PROMPT];

  if (options.toolName) {
    parti.push(
      `Il soggetto evoca ${options.toolName} in forma astratta: la sua funzione, non il suo marchio.`,
    );
  }

  if (options.hasLogo) {
    parti.push(
      'Fra i riferimenti c’è il logo dello strumento: serve a indicare gamma cromatica e ' +
        'geometria di base, e non va riprodotto né imitato come marchio.',
    );
  }

  return parti.join(' ');
}
