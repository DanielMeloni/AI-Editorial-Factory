/**
 * Aggancio fra un'affermazione del manuale e una pagina dell'indice ufficiale.
 *
 * Il problema è concreto: il manuale è in italiano, la documentazione in
 * inglese, e le due lingue devono incontrarsi senza che nessuno inventi nulla.
 * La soluzione è lessicale e pesata per rarità del termine (IDF): un termine
 * che compare in mezzo indice — «tabella» — vale poco; uno che compare in due
 * pagine — «partizionamento» — vale molto.
 *
 * Tre garanzie:
 *  - **nessuna proposta sotto soglia**: se nulla è pertinente, la funzione
 *    restituisce l'elenco vuoto e chi chiama lo dichiara;
 *  - **nessuna proposta su un termine solo**: una parola in comune è un caso,
 *    non una pertinenza (salvo un termine molto raro, che da solo basta);
 *  - **stabilità**: stesso testo, stesso indice, stesso ordine di risultati.
 */

import {
  CATALOG_ENTRIES,
  type CatalogEntry,
  type CatalogProduct,
} from './catalog';

/** Da dove viene una fonte proposta. Chi legge ha diritto di saperlo. */
export type SourceOrigin = 'catalogo_ufficiale' | 'biblioteca';

export interface SourceCandidate {
  /** Nullo per un PDF caricato: non ha un indirizzo pubblico. */
  url: string | null;
  title: string;
  section: string;
  product: CatalogProduct | null;
  origin: SourceOrigin;
  /** Fonte della biblioteca da cui proviene la proposta, quando è quello il caso. */
  referenceId: string | null;
  /** Pagina del PDF: una proposta indica dove guardare, non un documento intero. */
  page: number | null;
  /** Punteggio di pertinenza. Confrontabile solo fra candidati della stessa ricerca. */
  score: number;
  /** Termini che hanno prodotto l'aggancio: è ciò che il revisore legge per giudicare. */
  matchedTerms: string[];
}

/**
 * Voce interrogabile, qualunque ne sia la provenienza.
 *
 * L'indice ufficiale e la biblioteca del progetto finiscono nella stessa
 * struttura: si cerca una volta sola, i punteggi sono confrontabili, e la
 * distinzione fra le due resta scritta su ogni risultato invece di essere
 * affidata a due ricerche separate da riconciliare.
 */
export interface SearchableEntry {
  url: string | null;
  title: string;
  section: string;
  product: CatalogProduct | null;
  origin: SourceOrigin;
  referenceId: string | null;
  page: number | null;
  /** Termini che descrivono la voce. Per la biblioteca sono già canonici. */
  topics: readonly string[];
  /**
   * Moltiplicatore del punteggio. Le fonti della biblioteca valgono meno della
   * documentazione del produttore, a meno che l'autore non le abbia dichiarate
   * autorevoli: una specifica o una norma valgono quanto la doc ufficiale.
   */
  weight?: number;
}

/** Categoria dell'affermazione, usata per orientare la ricerca. */
export type ClaimCategory =
  | 'comportamento' | 'sintassi' | 'prestazioni' | 'costo' | 'limite' | 'altro';

export interface FindSourcesOptions {
  /** Numero massimo di candidati restituiti. */
  limit?: number;
  /** Soglia di pertinenza sotto la quale un candidato non viene proposto. */
  minScore?: number;
  /** Categoria dell'affermazione: privilegia le pagine che trattano quel tema. */
  category?: ClaimCategory | null;
}

/** Soglia predefinita, calibrata sulle affermazioni tipiche di un manuale tecnico. */
export const DEFAULT_MIN_SCORE = 1.2;

/** Numero predefinito di candidati proposti per affermazione. */
export const DEFAULT_LIMIT = 3;

/** Limite condiviso con lo schema Zod degli input degli agenti. */
export const MAX_MATCHED_TERMS = 20;

// ---------------------------------------------------------------------------
// Normalizzazione lessicale
// ---------------------------------------------------------------------------

/**
 * Parole che non distinguono un argomento dall'altro. Comprende l'italiano
 * dell'autore e l'inglese della documentazione.
 */
const STOPWORDS = new Set([
  // italiano
  'agli', 'alla', 'alle', 'allo', 'anche', 'ancora', 'avere', 'buona', 'che', 'chi',
  'come', 'con', 'contro', 'cui', 'dal', 'dai', 'del', 'dei', 'nel', 'nei', 'sul', 'sui',
  'era', 'sia', 'suo', 'sua', 'sue', 'suoi', 'lui', 'lei', 'più', 'gia',
  'cosa', 'dalla', 'dalle', 'dallo', 'degli', 'della', 'delle', 'dello', 'dentro',
  'dopo', 'dove', 'essere', 'fare', 'fino', 'gli', 'inoltre', 'invece', 'loro',
  'mentre', 'molto', 'nella', 'nelle', 'nello', 'noi', 'non', 'oppure', 'ogni',
  'per', 'perche', 'piu', 'poi', 'quale', 'quali', 'quando', 'quanto', 'quella',
  'quelle', 'quello', 'questa', 'queste', 'questi', 'questo', 'sempre', 'sono',
  'sopra', 'sotto', 'stato', 'stessa', 'stesso', 'sulla', 'sulle', 'sullo', 'tra',
  'tutta', 'tutte', 'tutti', 'tutto', 'una', 'uno', 'viene', 'vengono', 'solo',
  'caso', 'casi', 'modo', 'parte', 'volta', 'volte', 'esempio', 'cioe', 'quindi',
  // inglese
  'and', 'are', 'but', 'for', 'from', 'have', 'into', 'not', 'that', 'the', 'their',
  'then', 'there', 'this', 'these', 'those', 'was', 'were', 'with', 'you', 'your',
  // troppo generici in questo dominio
  'dato', 'dati', 'data', 'google', 'cloud', 'documentazione', 'documentation',
]);

/**
 * Forme diverse dello stesso concetto, ricondotte a un termine unico.
 *
 * È la parte che fa incontrare le due lingue. Viene applicata **da entrambi i
 * lati** — testo del capitolo e termini dell'indice — così l'indice può restare
 * scritto in modo naturale.
 */
const SYNONYMS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    // tabelle e viste
    tabella: 'table', tabelle: 'table', tables: 'table',
    vista: 'view', viste: 'view', views: 'view',
    materializzata: 'materialized', materializzate: 'materialized',
    // incrementale
    incrementale: 'incremental', incrementali: 'incremental', incrementalmente: 'incremental',
    // partizionamento
    partizione: 'partition', partizioni: 'partition', partizionamento: 'partition',
    partizionata: 'partition', partizionate: 'partition', partizionare: 'partition',
    partitioned: 'partition', partitioning: 'partition', partitionby: 'partition',
    // clustering
    clustering: 'cluster', clustered: 'cluster', clusterizzata: 'cluster',
    clusterizzate: 'cluster', clusterby: 'cluster',
    // costi
    costo: 'cost', costi: 'cost', costs: 'cost', prezzo: 'cost', prezzi: 'cost',
    pricing: 'cost', tariffa: 'cost', tariffe: 'cost', spesa: 'cost', spese: 'cost',
    fatturazione: 'billing', addebito: 'billing', addebiti: 'billing', fattura: 'billing',
    riduce: 'ridurre', riducono: 'ridurre', riduzione: 'ridurre', ridurre: 'ridurre',
    risparmio: 'ridurre', risparmia: 'ridurre',
    // prestazioni
    prestazione: 'performance', prestazioni: 'performance', performante: 'performance',
    ottimizza: 'optimize', ottimizzare: 'optimize', ottimizzazione: 'optimize',
    optimize: 'optimize', ottimale: 'optimize',
    veloce: 'performance', lento: 'performance', rapidita: 'performance',
    // limiti e quote
    limite: 'limit', limiti: 'limit', limits: 'limit', soglia: 'limit', soglie: 'limit',
    quota: 'quota', quote: 'quota', quotas: 'quota',
    massimo: 'limit', massima: 'limit', maximum: 'limit',
    // dipendenze
    dipendenza: 'dependency', dipendenze: 'dependency', dependencies: 'dependency',
    // dichiarazioni e sorgenti
    dichiarazione: 'declaration', dichiarazioni: 'declaration', dichiarare: 'declaration',
    declare: 'declaration', declarations: 'declaration',
    sorgente: 'source', sorgenti: 'source', sources: 'source',
    // asserzioni
    asserzione: 'assertion', asserzioni: 'assertion', assertions: 'assertion',
    // esecuzione e pianificazione
    esecuzione: 'execution', esecuzioni: 'execution', eseguire: 'execution',
    eseguita: 'execution', eseguito: 'execution', executions: 'execution', run: 'execution',
    pianificare: 'schedule', pianificazione: 'schedule', pianificata: 'schedule',
    scheduling: 'schedule', schedulazione: 'schedule',
    // configurazione
    configurazione: 'configuration', configurare: 'configuration', configura: 'configuration',
    configure: 'configuration', configurazioni: 'configuration',
    compilazione: 'compilation', compilare: 'compilation', compila: 'compilation',
    // sintassi
    sintassi: 'syntax', riferimento: 'reference', riferimenti: 'reference',
    // qualita
    qualita: 'quality', validazione: 'validation', validare: 'validation',
    // errori
    errore: 'error', errori: 'error', errors: 'error',
    problema: 'error', problemi: 'error',
    // varie
    query: 'query', queries: 'query', interrogazione: 'query', interrogare: 'query',
    scansione: 'scan', scansionati: 'scan', scansiona: 'scan', scanned: 'scan',
    aggiornamento: 'refresh', aggiornare: 'refresh', aggiorna: 'refresh',
    ricostruzione: 'ricostruzione', ricostruire: 'ricostruzione',
    javascript: 'javascript', js: 'javascript',
    autenticazione: 'authentication', permesso: 'permission', permessi: 'permission',
    workspace: 'workspace', repository: 'repository', repositories: 'repository',
  }),
);

/** Riconduce un termine alla sua forma canonica. */
export function normalizeTerm(token: string): string {
  return SYNONYMS.get(token) ?? token;
}

/**
 * Scompone un testo nei termini canonici che lo caratterizzano.
 * Gli accenti vengono rimossi: «qualità» e «qualita» sono lo stesso termine.
 */
export function tokenize(text: string): string[] {
  const plain = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const tokens: string[] = [];
  for (const raw of plain.split(/[^a-z0-9_]+/)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    const term = normalizeTerm(raw.replace(/_/g, ''));
    if (term.length < 3 || STOPWORDS.has(term)) continue;
    tokens.push(term);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Indice invertito, costruito una volta sola
// ---------------------------------------------------------------------------

/** Peso di un termine secondo la sua provenienza. */
const WEIGHT_TOPIC = 1;
const WEIGHT_TITLE = 0.8;
const WEIGHT_SLUG = 0.5;

interface IndexedEntry {
  entry: SearchableEntry;
  /** Termine canonico → peso massimo con cui compare nella voce. */
  terms: ReadonlyMap<string, number>;
}

/** Indice invertito interrogabile. Costruito una volta, riusato per ogni ricerca. */
export interface SourceIndex {
  entries: IndexedEntry[];
  idf: ReadonlyMap<string, number>;
  /** IDF di un termine presente in una voce sola: il massimo osservabile. */
  maxIdf: number;
}

function slugTerms(url: string | null): string[] {
  if (url === null) return [];
  try {
    return tokenize(new URL(url).pathname.replace(/[/-]/g, ' '));
  } catch {
    return [];
  }
}

/** Costruisce l'indice invertito di un insieme di voci. */
export function buildSourceIndex(entries: readonly SearchableEntry[]): SourceIndex {
  const indexed: IndexedEntry[] = entries.map((entry) => {
    const terms = new Map<string, number>();

    const add = (token: string, weight: number) => {
      const term = normalizeTerm(token);
      if (term.length < 3 || STOPWORDS.has(term)) return;
      terms.set(term, Math.max(terms.get(term) ?? 0, weight));
    };

    for (const topic of entry.topics) for (const t of tokenize(topic)) add(t, WEIGHT_TOPIC);
    for (const t of tokenize(entry.title)) add(t, WEIGHT_TITLE);
    for (const t of slugTerms(entry.url)) add(t, WEIGHT_SLUG);

    return { entry, terms };
  });

  const documentFrequency = new Map<string, number>();
  for (const { terms } of indexed) {
    for (const term of terms.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = Math.max(indexed.length, 1);
  const idf = new Map<string, number>();
  for (const [term, df] of documentFrequency) {
    // Logaritmo smorzato: un termine presente ovunque tende a zero, uno raro
    // resta alto senza dominare da solo il punteggio.
    idf.set(term, Math.log(1 + total / df));
  }

  return { entries: indexed, idf, maxIdf: Math.log(1 + total) };
}

/** L'indice curato come voci interrogabili. */
export function catalogAsEntries(
  entries: readonly CatalogEntry[] = CATALOG_ENTRIES,
): SearchableEntry[] {
  return entries.map((entry) => ({
    url: entry.url,
    title: entry.title,
    section: entry.section,
    product: entry.product,
    origin: 'catalogo_ufficiale' as const,
    referenceId: null,
    page: null,
    topics: entry.topics,
  }));
}

/** Indice della sola documentazione ufficiale, costruito una volta sola. */
export const OFFICIAL_INDEX: SourceIndex = buildSourceIndex(catalogAsEntries());

// ---------------------------------------------------------------------------
// Orientamento per categoria
// ---------------------------------------------------------------------------

/**
 * Termini che caratterizzano ciascuna categoria di affermazione.
 * Non aggiungono un aggancio dove non c'è: rafforzano quelli già trovati.
 */
const CATEGORY_TERMS: Record<ClaimCategory, readonly string[]> = {
  costo: ['cost', 'billing', 'ridurre'],
  prestazioni: ['performance', 'optimize', 'partition', 'cluster'],
  limite: ['limit', 'quota'],
  sintassi: ['syntax', 'reference'],
  comportamento: ['execution', 'configuration'],
  altro: [],
};

const CATEGORY_BOOST = 1.2;

// ---------------------------------------------------------------------------
// Ricerca
// ---------------------------------------------------------------------------

/**
 * Cerca in un indice le voci che sostengono un'affermazione.
 *
 * Restituisce l'elenco vuoto quando nulla supera la soglia: è un esito
 * legittimo, non un fallimento, e va riferito al revisore come tale.
 *
 * Quando più blocchi della stessa fonte agganciano — pagine diverse dello
 * stesso PDF — resta il migliore: al revisore serve sapere *dove* guardare, non
 * ricevere lo stesso documento tre volte.
 */
export function searchIndex(
  index: SourceIndex,
  text: string,
  options: FindSourcesOptions = {},
): SourceCandidate[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const category = options.category ?? null;

  const queryTerms = new Set(tokenize(text));
  if (queryTerms.size === 0) return [];

  // Le frasi lunghe non devono ottenere punteggi più alti solo perché contengono
  // più parole: il punteggio viene rapportato alla radice del numero di termini.
  const lengthFactor = Math.sqrt(Math.min(queryTerms.size, 12));
  const boostTerms = category ? CATEGORY_TERMS[category] : [];

  const scored: SourceCandidate[] = [];

  for (const { entry, terms } of index.entries) {
    let score = 0;
    let rarest = 0;
    const matched: string[] = [];

    for (const term of queryTerms) {
      const weight = terms.get(term);
      if (weight === undefined) continue;
      score += (index.idf.get(term) ?? 0) * weight;
      rarest = Math.max(rarest, index.idf.get(term) ?? 0);
      matched.push(term);
    }

    if (matched.length === 0) continue;

    score /= lengthFactor;

    if (boostTerms.length > 0 && boostTerms.some((term) => terms.has(term))) {
      score *= CATEGORY_BOOST;
    }

    score *= entry.weight ?? 1;

    if (score < minScore) continue;

    // Un solo termine in comune è quasi sempre un caso, non una pertinenza. Lo
    // si accetta soltanto se il termine è raro **e** il punteggio è nettamente
    // sopra soglia: «partizionamento» sì, «organizzare» no.
    if (matched.length < 2 && !(rarest >= index.maxIdf * 0.75 && score >= minScore * 2)) {
      continue;
    }

    scored.push({
      url: entry.url,
      title: entry.title,
      section: entry.section,
      product: entry.product,
      origin: entry.origin,
      referenceId: entry.referenceId,
      page: entry.page,
      score: Math.round(score * 1000) / 1000,
      // Un capitolo lungo può condividere decine di termini con una fonte.
      // Conserviamo quelli che hanno contribuito di più al punteggio: oltre
      // questo limite il dettaglio non aiuta il revisore e non è accettato
      // dal contratto Zod passato agli agenti.
      matchedTerms: matched
        .sort((a, b) => {
          const contributionA = (index.idf.get(a) ?? 0) * (terms.get(a) ?? 0);
          const contributionB = (index.idf.get(b) ?? 0) * (terms.get(b) ?? 0);
          return contributionB - contributionA || a.localeCompare(b);
        })
        .slice(0, MAX_MATCHED_TERMS)
        .sort(),
    });
  }

  // Ordinamento stabile: punteggio, poi termini agganciati, poi identità.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.matchedTerms.length - a.matchedTerms.length ||
      (a.url ?? a.referenceId ?? '').localeCompare(b.url ?? b.referenceId ?? '') ||
      (a.page ?? 0) - (b.page ?? 0),
  );

  const visti = new Set<string>();
  const unici: SourceCandidate[] = [];
  for (const candidato of scored) {
    const chiave = candidato.referenceId ?? candidato.url ?? candidato.title;
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    unici.push(candidato);
    if (unici.length >= limit) break;
  }

  return unici;
}

/**
 * Cerca nella sola documentazione ufficiale.
 * È l'esito predefinito quando non c'è una biblioteca di progetto da consultare.
 */
export function findSources(
  text: string,
  options: FindSourcesOptions = {},
): SourceCandidate[] {
  return searchIndex(OFFICIAL_INDEX, text, options);
}
