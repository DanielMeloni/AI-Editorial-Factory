import { FORMATI, formatoLibro, parolePerPagina } from '@/lib/editorial/pagine';

/**
 * Brief del progetto: che cosa si sta costruendo.
 *
 * La direzione editoriale — livello, tono, registro — dice **come** si scrive.
 * Il brief dice **cosa**: la forma dell'opera, quanto deve essere lunga, cosa
 * copre e cosa lascia fuori, per chi è. Sono le informazioni che un editore
 * darebbe a un autore prima di commissionargli un lavoro, e senza le quali il
 * Curriculum Agent conosce il titolo e deve indovinare il resto.
 *
 * Come per la direzione, ogni voce porta con sé l'istruzione che finisce nel
 * prompt: etichetta e istruzione nello stesso posto, così l'interfaccia non può
 * promettere una cosa e il modello riceverne un'altra.
 */

export type FormaOpera = 'volume_singolo' | 'collana' | 'guida_rapida';

export interface VoceForma {
  value: FormaOpera;
  label: string;
  hint: string;
  istruzione: string;
}

export const FORME: VoceForma[] = [
  {
    value: 'volume_singolo',
    label: 'Volume unico',
    hint: 'Un’opera che si chiude in sé',
    istruzione:
      'Forma: volume unico. L’opera deve bastare a sé stessa: chi la legge non deve procurarsi ' +
      'altri volumi per arrivare in fondo all’argomento dichiarato.',
  },
  {
    value: 'collana',
    label: 'Collana per livelli',
    hint: 'Un volume per livello, da leggere in sequenza',
    istruzione:
      'Forma: volume di una collana articolata per livelli. Copri **soltanto** ciò che compete a ' +
      'questo livello: ciò che appartiene ai livelli successivi va nominato e rimandato, non ' +
      'trattato. Dai per acquisito ciò che i volumi precedenti hanno già spiegato, senza ripassarlo.',
  },
  {
    value: 'guida_rapida',
    label: 'Guida rapida',
    hint: 'Breve, operativa, consultabile',
    istruzione:
      'Forma: guida rapida. Privilegia le regole operative e gli esempi immediatamente ' +
      'applicabili; niente storia dello strumento, niente digressioni, niente confronti estesi ' +
      'con le alternative. Il lettore consulta più che leggere: ogni sezione deve reggere da sola.',
  },
];

export interface BriefProgetto {
  workShape: string | null | undefined;
  targetPages: number | null | undefined;
  scope: string | null | undefined;
  outOfScope: string | null | undefined;
  audience: string | null | undefined;
  /** Misure rifilate del volume, quando la copertina è già stata impostata. */
  trim?: { widthMm: number; heightMm: number } | null;
}

function trovaForma(valore: string | null | undefined): VoceForma {
  return FORME.find((voce) => voce.value === valore) ?? FORME[0]!;
}

/**
 * Budget di scrittura ricavato dalle pagine obiettivo.
 *
 * «Cento pagine» non è un'istruzione che un modello sappia rispettare: parla di
 * carta, e il modello produce parole. La conversione usa la stessa densità con
 * cui l'applicazione stima le pagine altrove — una sola tabella per entrambe le
 * direzioni, altrimenti l'obiettivo dichiarato e quello mostrato divergerebbero.
 */
export function budgetParole(
  targetPages: number | null | undefined,
  trim?: { widthMm: number; heightMm: number } | null,
): number | null {
  if (!targetPages || targetPages <= 0) return null;
  const formato = trim ? formatoLibro(trim) : FORMATI.find((f) => f.key === 'libro')!;
  return Math.round(targetPages * parolePerPagina(formato));
}

/** Le istruzioni del brief, in un blocco solo. Vuoto se non c'è nulla da dire. */
export function istruzioniBrief(brief: BriefProgetto): string {
  const parole = budgetParole(brief.targetPages, brief.trim);

  const righe = [
    'Brief dell’opera — vincola l’ampiezza dell’indice e la profondità dei capitoli:',
    `- ${trovaForma(brief.workShape).istruzione}`,
    brief.audience?.trim() ? `- Pubblico: ${brief.audience.trim()}` : '',
    brief.scope?.trim() ? `- Deve coprire: ${brief.scope.trim()}` : '',
    // L'esclusione è più efficace dell'inclusione: dire cosa non si tratta
    // impedisce all'indice di allargarsi fino a diventare inutilizzabile.
    brief.outOfScope?.trim() ? `- Resta fuori, da non trattare: ${brief.outOfScope.trim()}` : '',
    parole
      ? `- Dimensione obiettivo: circa ${brief.targetPages} pagine, ovvero all’incirca ` +
        `${parole.toLocaleString('it-IT')} parole in tutto. Dimensiona il numero dei capitoli e ` +
        'la loro ampiezza su questo totale: un indice che non ci sta dentro produce un’opera ' +
        'incompiuta, uno troppo largo produce capitoli sottili.'
      : '',
  ].filter(Boolean);

  return righe.length > 1 ? righe.join('\n') : '';
}

/** Etichetta breve per l'interfaccia. */
export function etichettaBrief(brief: BriefProgetto): string {
  const forma = trovaForma(brief.workShape).label;
  return brief.targetPages ? `${forma} · ~${brief.targetPages} pagine` : forma;
}
