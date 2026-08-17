import { z } from 'zod';

/**
 * Contratti degli agenti.
 *
 * Gli agenti non si passano testo libero: ogni esecuzione ha un input e un
 * output validati. Uno schema violato è un errore di esecuzione, non un
 * risultato da interpretare a valle.
 */

// ---------------------------------------------------------------------------
// Elementi condivisi
// ---------------------------------------------------------------------------

export const severitySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export const issueKindSchema = z.enum([
  'technical', 'editorial', 'source', 'curriculum', 'visual', 'structural',
]);

export const locationSchema = z.object({
  line: z.number().int().nonnegative().nullable(),
  heading: z.string().nullable(),
  excerpt: z.string().max(500).nullable(),
});

export const issueSchema = z.object({
  kind: issueKindSchema,
  severity: severitySchema,
  title: z.string().min(1).max(300),
  detail: z.string().max(4000),
  suggestion: z.string().max(4000).nullable(),
  location: locationSchema,
  evidence: z.array(z.string().max(500)).max(20),
});

export type Issue = z.infer<typeof issueSchema>;

// ---------------------------------------------------------------------------
// Ingresso comune degli agenti che lavorano su un capitolo
// ---------------------------------------------------------------------------

export const codeBlockSchema = z.object({
  language: z.string().nullable(),
  content: z.string(),
  line: z.number().int().nonnegative(),
});

export const chapterInputSchema = z.object({
  chapterId: z.string().uuid(),
  number: z.number().int().nullable(),
  title: z.string(),
  contentMd: z.string().min(1),
  headings: z.array(z.object({ level: z.number().int(), text: z.string(), line: z.number().int() })),
  codeBlocks: z.array(codeBlockSchema),
  links: z.array(z.object({ url: z.string(), text: z.string(), line: z.number().int() })),
  figures: z.array(z.object({ alt: z.string(), src: z.string(), line: z.number().int() })),
  placeholders: z.array(z.object({ description: z.string(), line: z.number().int() })),
});

export type ChapterInput = z.infer<typeof chapterInputSchema>;

// ---------------------------------------------------------------------------
// Technical Verifier
// ---------------------------------------------------------------------------

export const verifiableClaimSchema = z.object({
  statement: z.string().max(600),
  line: z.number().int().nonnegative(),
  /** Vero se il testo indica una fonte a supporto dell'affermazione. */
  hasSupportingSource: z.boolean(),
  category: z.enum(['comportamento', 'sintassi', 'prestazioni', 'costo', 'limite', 'altro']),
});

export type VerifiableClaim = z.infer<typeof verifiableClaimSchema>;

export const technicalVerifierOutputSchema = z.object({
  claims: z.array(verifiableClaimSchema).max(200),
  issues: z.array(issueSchema).max(200),
  codeFindings: z.array(
    z.object({
      line: z.number().int().nonnegative(),
      language: z.string().nullable(),
      rule: z.string(),
      severity: severitySchema,
      message: z.string().max(1000),
    }),
  ).max(200),
  /** Dipendenze `ref()` e `self()` individuate nei blocchi Dataform. */
  dataformRefs: z.array(z.string()).max(200),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(2000),
});

export type TechnicalVerifierOutput = z.infer<typeof technicalVerifierOutputSchema>;

// ---------------------------------------------------------------------------
// Source Auditor
// ---------------------------------------------------------------------------

/** Esito del confronto di un riferimento con l'indice curato. */
export const citationVerificationSchema = z.enum([
  'ufficiale_indicizzata',
  'ufficiale_non_indicizzata',
  'comunita',
  'sconosciuta',
  'non_valida',
]);

export const citationSchema = z.object({
  url: z.string(),
  line: z.number().int().nonnegative(),
  text: z.string().max(300),
  isOfficial: z.boolean(),
  domain: z.string(),
  note: z.string().max(500).nullable(),
  /** Vero se la pagina risulta nell'indice curato delle fonti ufficiali. */
  inIndex: z.boolean(),
  verification: citationVerificationSchema,
  indexedTitle: z.string().max(300).nullable(),
});

/**
 * Pagina ufficiale proposta a sostegno di un'affermazione.
 *
 * Proviene sempre dall'indice curato: `url` e `title` non sono generati, sono
 * letti. `matchedTerms` è il motivo della proposta, ed è ciò che il revisore
 * guarda per accettarla o scartarla in un istante.
 */
export const sourceOriginSchema = z.enum(['catalogo_ufficiale', 'biblioteca']);

export const sourceCandidateSchema = z.object({
  /** Nullo per un PDF della biblioteca: non ha un indirizzo pubblico. */
  url: z.string().nullable(),
  title: z.string().max(300),
  section: z.string().max(200),
  product: z.enum(['dataform', 'bigquery']).nullable(),
  /** Documentazione del produttore o biblioteca del progetto: la differenza resta scritta. */
  origin: sourceOriginSchema,
  referenceId: z.string().uuid().nullable(),
  /** Pagina del PDF: la proposta indica dove guardare, non un documento intero. */
  page: z.number().int().positive().nullable(),
  score: z.number().nonnegative(),
  matchedTerms: z.array(z.string().max(60)).max(20),
});

export type SourceCandidateOutput = z.infer<typeof sourceCandidateSchema>;

/** Un'affermazione priva di fonte e le pagine ufficiali che potrebbero sostenerla. */
export const sourceSuggestionSchema = z.object({
  line: z.number().int().nonnegative(),
  statement: z.string().max(600),
  category: z.enum(['comportamento', 'sintassi', 'prestazioni', 'costo', 'limite', 'altro']),
  /** Vuoto quando l'indice non contiene nulla di pertinente: è un esito, non un errore. */
  candidates: z.array(sourceCandidateSchema).max(5),
});

export type SourceSuggestion = z.infer<typeof sourceSuggestionSchema>;

export const sourceAuditOutputSchema = z.object({
  citations: z.array(citationSchema).max(200),
  /** Fonti cercate automaticamente per le affermazioni che ne erano prive. */
  suggestions: z.array(sourceSuggestionSchema).max(100),
  /** Affermazioni senza fonte per le quali l'indice non ha proposto nulla. */
  unmatchedClaims: z.number().int().nonnegative(),
  issues: z.array(issueSchema).max(100),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(2000),
});

export type SourceAuditOutput = z.infer<typeof sourceAuditOutputSchema>;

// ---------------------------------------------------------------------------
// Technical Writer — proposta di revisione
// ---------------------------------------------------------------------------

export const revisionOutputSchema = z.object({
  /** Testo completo proposto. Non sostituisce l'originale: genera una versione. */
  contentMd: z.string().min(1),
  changes: z.array(
    z.object({
      kind: z.enum([
        'linguaggio_codice', 'testo_alternativo', 'nota_verifica',
        'fonte_proposta', 'terminologia', 'struttura',
      ]),
      line: z.number().int().nonnegative(),
      description: z.string().max(500),
    }),
  ).max(500),
  /** Nulla è stato riscritto nel merito: solo interventi dichiarati. */
  preservesMeaning: z.boolean(),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(2000),
});

export type RevisionOutput = z.infer<typeof revisionOutputSchema>;

// ---------------------------------------------------------------------------
// Piano visuale e diagrammi
// ---------------------------------------------------------------------------

export const visualPlanItemSchema = z.object({
  kind: z.enum(['diagramma', 'illustrazione']),
  diagramType: z.enum(['dag', 'flusso', 'architettura', 'sequenza', 'confronto']).nullable(),
  title: z.string().max(200),
  caption: z.string().max(500),
  altText: z.string().max(500),
  /** Riga del capitolo a cui la figura si riferisce. */
  line: z.number().int().nonnegative(),
  rationale: z.string().max(1000),
});

export const visualPlanOutputSchema = z.object({
  items: z.array(visualPlanItemSchema).max(50),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(2000),
});

export type VisualPlanOutput = z.infer<typeof visualPlanOutputSchema>;

export const diagramOutputSchema = z.object({
  /** Sorgente Mermaid: deterministica, non prodotta da un modello visuale. */
  mermaid: z.string().min(1),
  title: z.string().max(200),
  caption: z.string().max(500),
  altText: z.string().max(500),
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
});

export type DiagramOutput = z.infer<typeof diagramOutputSchema>;

// ---------------------------------------------------------------------------
// Audit complessivo del capitolo
// ---------------------------------------------------------------------------

export const chapterAuditSchema = z.object({
  chapterId: z.string().uuid(),
  generatedAt: z.string(),
  technical: technicalVerifierOutputSchema,
  sources: sourceAuditOutputSchema,
  totals: z.object({
    issues: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    claims: z.number().int().nonnegative(),
    citations: z.number().int().nonnegative(),
    /** Affermazioni per cui l'indice ufficiale ha proposto almeno una fonte. */
    suggestedSources: z.number().int().nonnegative(),
  }),
});

export type ChapterAudit = z.infer<typeof chapterAuditSchema>;

// ---------------------------------------------------------------------------
// Ricerca web delle fonti di riferimento
// ---------------------------------------------------------------------------

/**
 * Un indirizzo trovato sul web e **già verificato**: è stato aperto, ha
 * risposto, e il titolo è quello letto dalla pagina. Ciò che arriva all'agente
 * di selezione esiste: resta da decidere se è utile.
 */
export const webCandidateSchema = z.object({
  url: z.string(),
  title: z.string().max(300),
  domain: z.string().max(200),
  isOfficial: z.boolean(),
  isCommunity: z.boolean(),
  excerpt: z.string().max(1000).nullable(),
});

export type WebCandidate = z.infer<typeof webCandidateSchema>;

export const sourceDiscoveryInputSchema = z.object({
  projectTitle: z.string().max(300),
  subtitle: z.string().max(300).nullable(),
  language: z.string().max(10),
  /** Argomenti del volume, ricavati dai titoli dei capitoli. */
  topics: z.array(z.string().max(200)).max(60),
  candidates: z.array(webCandidateSchema).max(60),
});

export type SourceDiscoveryInput = z.infer<typeof sourceDiscoveryInputSchema>;

/** Che genere di fonte è: cambia il peso che le si dà, e come si cita. */
export const webSourceKindSchema = z.enum([
  'documentazione_ufficiale',
  'riferimento_api',
  'specifica',
  'guida',
  'articolo',
  'altro',
]);

export const sourceDiscoveryOutputSchema = z.object({
  selected: z.array(
    z.object({
      url: z.string(),
      title: z.string().max(300),
      kind: webSourceKindSchema,
      /** Perché serve a questo manuale. È ciò che il revisore legge per decidere. */
      rationale: z.string().max(600),
      /** Da 1 (irrinunciabile) a 3 (utile). */
      priority: z.number().int().min(1).max(3),
    }),
  ).max(40),
  /** Indirizzi esaminati e scartati, con il motivo: il silenzio non spiega nulla. */
  discarded: z.array(
    z.object({ url: z.string(), reason: z.string().max(300) }),
  ).max(60),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(2000),
});

export type SourceDiscoveryOutput = z.infer<typeof sourceDiscoveryOutputSchema>;
