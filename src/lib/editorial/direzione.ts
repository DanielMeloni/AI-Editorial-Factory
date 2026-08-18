/**
 * Direzione editoriale di un'opera: a chi parla, con che voce, in che registro.
 *
 * Vive in un file solo perché tre cose devono restare d'accordo: il vincolo del
 * database, il modulo di creazione e i prompt degli agenti. Se il vocabolario si
 * sdoppiasse, il primo valore aggiunto altrove passerebbe la validazione e
 * arriverebbe al modello come istruzione muta.
 *
 * Ogni voce porta con sé la propria `istruzione`: non è una didascalia per
 * l'interfaccia, è il testo che finisce nel prompt. Tenere l'etichetta e
 * l'istruzione nello stesso posto è ciò che impedisce che l'interfaccia prometta
 * una cosa e il modello ne riceva un'altra.
 */

export interface VoceEditoriale<T extends string> {
  value: T;
  label: string;
  hint: string;
  istruzione: string;
}

export type Livello = 'base' | 'intermediate' | 'advanced';

export const LIVELLI: VoceEditoriale<Livello>[] = [
  {
    value: 'base',
    label: 'Base',
    hint: 'Per chi parte da zero',
    istruzione:
      'Livello base: il lettore non conosce lo strumento. Introduci ogni concetto prima di usarlo, ' +
      'non dare per scontato alcun prerequisito oltre le nozioni generali del settore, procedi per ' +
      'passi verificabili e privilegia un esempio completo a molti esempi parziali. ' +
      'Niente scorciatoie da esperti, niente ottimizzazioni premature.',
  },
  {
    value: 'intermediate',
    label: 'Intermedio',
    hint: 'Per chi lo usa già',
    istruzione:
      'Livello intermedio: il lettore usa già lo strumento e ne conosce il vocabolario di base. ' +
      'Salta le presentazioni, concentra lo spazio su composizione, casi realistici, errori ' +
      'frequenti e criteri di scelta fra alternative. Puoi usare i termini tecnici senza definirli, ' +
      'ma spiega sempre il perché di una scelta, non solo il come.',
  },
  {
    value: 'advanced',
    label: 'Avanzato',
    hint: 'Per chi progetta e decide',
    istruzione:
      'Livello avanzato: il lettore progetta soluzioni e ne risponde. Tratta architettura, limiti ' +
      'del sistema, costi, prestazioni, casi di confine e conseguenze operative delle scelte. ' +
      'Confronta approcci dichiarando i compromessi. Evita ogni ripasso dei fondamenti: ' +
      'se un fondamento serve, rimandalo al volume che lo tratta.',
  },
];

export type Tono = 'didattico' | 'professionale' | 'discorsivo' | 'conciso';

export const TONI: VoceEditoriale<Tono>[] = [
  {
    value: 'didattico',
    label: 'Didattico',
    hint: 'Accompagna il lettore',
    istruzione:
      'Tono didattico: accompagna il lettore, anticipa cosa imparerà, ricapitola quando serve, ' +
      'usa la seconda persona. Nessuna condiscendenza.',
  },
  {
    value: 'professionale',
    label: 'Professionale',
    hint: 'Neutro e asciutto',
    istruzione:
      'Tono professionale: impersonale e asciutto, senza rivolgersi direttamente al lettore, ' +
      'senza entusiasmo dichiarato. Afferma e documenta.',
  },
  {
    value: 'discorsivo',
    label: 'Discorsivo',
    hint: 'Argomenta e racconta',
    istruzione:
      'Tono discorsivo: argomenta il ragionamento per esteso, collega i concetti fra loro, ' +
      'ammette le zone grigie invece di appiattirle.',
  },
  {
    value: 'conciso',
    label: 'Conciso',
    hint: 'Solo l’essenziale',
    istruzione:
      'Tono conciso: frasi brevi, nessuna ripetizione, nessuna introduzione di cortesia. ' +
      'Ogni paragrafo porta un’informazione nuova.',
  },
];

export type Registro = 'divulgativo' | 'tecnico_operativo' | 'rigoroso_formale';

export const REGISTRI: VoceEditoriale<Registro>[] = [
  {
    value: 'divulgativo',
    label: 'Divulgativo',
    hint: 'Analogie e linguaggio comune',
    istruzione:
      'Registro divulgativo: linguaggio comune, analogie concrete, termini tecnici introdotti ' +
      'alla prima occorrenza. Il codice resta, ma è sempre commentato a parole.',
  },
  {
    value: 'tecnico_operativo',
    label: 'Tecnico-operativo',
    hint: 'Il linguaggio del mestiere',
    istruzione:
      'Registro tecnico-operativo: terminologia del mestiere usata con precisione, procedure ' +
      'eseguibili, comandi e configurazioni riportati per esteso.',
  },
  {
    value: 'rigoroso_formale',
    label: 'Rigoroso-formale',
    hint: 'Precisione da specifica',
    istruzione:
      'Registro rigoroso-formale: precisione da specifica, ogni affermazione circoscritta alle ' +
      'condizioni in cui vale, nessuna semplificazione che alteri il significato.',
  },
];

export interface DirezioneEditoriale {
  level: Livello;
  tone: Tono;
  register: Registro;
  styleNotes: string | null;
}

/**
 * La forma con cui la direzione arriva dal database: stringhe, non unioni.
 *
 * Accettarla così evita le conversioni forzate al bordo, e soprattutto rende
 * innocuo un valore che non conosciamo — degrada al primo della lista invece di
 * far saltare la generazione.
 */
export interface DirezioneGrezza {
  level: string | null | undefined;
  tone: string | null | undefined;
  register: string | null | undefined;
  styleNotes: string | null | undefined;
}

function trova<T extends string>(
  elenco: VoceEditoriale<T>[],
  valore: string | null | undefined,
): VoceEditoriale<T> {
  return elenco.find((voce) => voce.value === valore) ?? elenco[0]!;
}

/** Le istruzioni da consegnare al modello, in un blocco solo. */
export function istruzioniEditoriali(direzione: DirezioneGrezza): string {
  return [
    'Direzione editoriale di quest’opera — vincola indice, taglio e scrittura:',
    `- ${trova(LIVELLI, direzione.level).istruzione}`,
    `- ${trova(TONI, direzione.tone).istruzione}`,
    `- ${trova(REGISTRI, direzione.register).istruzione}`,
    direzione.styleNotes?.trim()
      ? `- Indicazioni dell’autore, prevalgono sulle precedenti: ${direzione.styleNotes.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Etichetta breve per l'interfaccia. */
export function etichettaDirezione(direzione: DirezioneGrezza): string {
  return [
    trova(LIVELLI, direzione.level).label,
    trova(TONI, direzione.tone).label.toLowerCase(),
    trova(REGISTRI, direzione.register).label.toLowerCase(),
  ].join(' · ');
}
