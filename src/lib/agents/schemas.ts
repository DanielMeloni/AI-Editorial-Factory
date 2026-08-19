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

// ---------------------------------------------------------------------------
// Stesura del capitolo
// ---------------------------------------------------------------------------

/**
 * Ingresso della stesura.
 *
 * L'agente riceve soltanto ciò su cui è autorizzato a basarsi: l'obiettivo del
 * capitolo, le fonti disponibili e i loro estratti. Non ha accesso ad altro, ed
 * è questa la garanzia — non una raccomandazione nel prompt.
 */
export const chapterDraftInputSchema = z.object({
  chapterId: z.string().uuid(),
  number: z.number().int().nullable(),
  title: z.string(),
  /** Obiettivo dichiarato in fase di struttura, quando c'è. */
  objective: z.string().max(2000),
  partTitle: z.string().nullable(),
  language: z.string().max(20),
  /** Direzione editoriale già tradotta in istruzioni per il modello. */
  direzione: z.string().max(9000),
  references: z
    .array(
      z.object({
        title: z.string().max(300),
        publisher: z.string().max(200).nullable(),
        url: z.string().max(600).nullable(),
      }),
    )
    .max(60),
  /** Estratti dalle fonti e dall'archivio del manoscritto. */
  evidence: z.string(),
  /** Testo già presente: per un segnaposto è il solo titolo con l'obiettivo. */
  existingContent: z.string(),
});

export type ChapterDraftInput = z.infer<typeof chapterDraftInputSchema>;

export const chapterDraftOutputSchema = z.object({
  /** Il capitolo intero in Markdown, intestazione compresa. */
  contentMd: z.string().min(1),
  /**
   * Falso quando il modello ha dovuto scrivere qualcosa che le fonti non
   * sostengono. Dichiararlo vale più che negarlo: il revisore sa dove guardare.
   */
  groundedOnly: z.boolean(),
  /** Punti che le fonti non coprono e che restano da verificare a mano. */
  gaps: z.array(z.string().max(500)).max(30),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(2000),
});

export type ChapterDraftOutput = z.infer<typeof chapterDraftOutputSchema>;

// ---------------------------------------------------------------------------
// Stesura in più passaggi: piano, sezioni, apparato
// ---------------------------------------------------------------------------

/**
 * Un capitolo completo non entra in una risposta sola.
 *
 * Chiedere «scrivi il capitolo» a un modello con un tetto di token produce un
 * capitolo troncato o, peggio, un capitolo che si accorcia da solo per starci
 * dentro: sezioni annunciate e mai scritte, esempi promessi e assenti. Si
 * pianifica, si scrive una sezione per volta, si compone l'apparato. Ogni
 * passaggio ha spazio sufficiente per essere completo.
 */

export const chapterPlanOutputSchema = z.object({
  /** Obiettivi dichiarati in apertura, come vuole la convenzione del volume. */
  objectives: z.array(z.string().max(300)).min(2).max(8),
  sections: z
    .array(
      z.object({
        title: z.string().min(3).max(200),
        /** Cosa deve ottenere la sezione: guida chi la scriverà. */
        intent: z.string().min(10).max(600),
        needsCode: z.boolean(),
        needsFigure: z.boolean(),
      }),
    )
    .min(3)
    .max(12),
  confidence: z.number().min(0).max(1),
});

export type ChapterPlanOutput = z.infer<typeof chapterPlanOutputSchema>;

export const chapterSectionOutputSchema = z.object({
  /** La sola sezione, con il proprio titolo di secondo livello. */
  contentMd: z.string().min(1),
  /** Punti che le fonti non coprono, dichiarati invece che colmati. */
  gaps: z.array(z.string().max(300)).max(10),
});

export type ChapterSectionOutput = z.infer<typeof chapterSectionOutputSchema>;

export const chapterApparatusOutputSchema = z.object({
  bestPractices: z.array(z.string().max(800)).max(8),
  commonErrors: z.array(z.string().max(800)).max(8),
  summary: z.string().max(4000),
  keyPoints: z.array(z.string().max(400)).min(3).max(10),
  quiz: z
    .array(
      z.object({
        question: z.string().max(400),
        options: z.array(z.string().max(300)).length(4),
        /** Indice della risposta corretta, da 0 a 3. */
        correct: z.number().int().min(0).max(3),
      }),
    )
    .min(3)
    .max(8),
  /** Il laboratorio con cui si chiude ogni capitolo del volume. */
  lab: z.string().max(4000),
  gaps: z.array(z.string().max(300)).max(10),
});

export type ChapterApparatusOutput = z.infer<typeof chapterApparatusOutputSchema>;

// ---------------------------------------------------------------------------
// Derivazioni: articoli per il blog
// ---------------------------------------------------------------------------

/**
 * Ingresso comune di piano e stesura.
 *
 * Contiene ciò su cui è lecito basarsi — estratti del manuale e direzione
 * editoriale — e nient'altro: un articolo che parla di cose non presenti
 * nell'opera prometterebbe al lettore un manuale che non esiste.
 */
export const blogPlanInputSchema = z.object({
  projectTitle: z.string().max(300),
  projectSubtitle: z.string().max(300).nullable(),
  direzione: z.string().max(9000),
  language: z.string().max(20),
  /** Quanti articoli sono stati chiesti. */
  count: z.number().int().min(1).max(30),
  /** Indice dell'opera: titoli di parti e capitoli approvati. */
  outline: z.array(z.string().max(300)).max(200),
  evidence: z.string(),
});

export type BlogPlanInput = z.infer<typeof blogPlanInputSchema>;

export const blogPlanOutputSchema = z.object({
  articles: z
    .array(
      z.object({
        title: z.string().min(3).max(200),
        /** Cosa rende questo pezzo diverso dagli altri. */
        angle: z.string().min(10).max(600),
        targetKeyword: z.string().max(120),
        secondaryKeywords: z.array(z.string().max(120)).max(10),
        /** Informativo, comparativo, procedurale, di soluzione a un problema. */
        searchIntent: z.string().max(120),
      }),
    )
    .min(1)
    .max(30),
  /** Perché sono meno di quanti chiesti, quando lo sono. */
  note: z.string().max(1000),
});

export type BlogPlanOutput = z.infer<typeof blogPlanOutputSchema>;

export const blogArticleInputSchema = blogPlanInputSchema.extend({
  title: z.string().max(200),
  angle: z.string().max(600),
  targetKeyword: z.string().max(120),
  secondaryKeywords: z.array(z.string().max(120)).max(10),
  searchIntent: z.string().max(120),
  /** Gli altri titoli del piano: per non ripetere e per collegarli fra loro. */
  siblings: z.array(z.string().max(200)).max(30),
});

export type BlogArticleInput = z.infer<typeof blogArticleInputSchema>;

export const blogArticleOutputSchema = z.object({
  /** Il pezzo intero in Markdown, dal titolo di primo livello. */
  contentMd: z.string().min(1),
  slug: z.string().max(120),
  metaTitle: z.string().max(70),
  metaDescription: z.string().max(160),
  /**
   * La risposta in due righe, in apertura.
   *
   * È ciò che un sistema che risponde citando estrae per primo: senza, il pezzo
   * viene letto ma non ripreso.
   */
  answerSummary: z.string().max(400),
  keyTakeaways: z.array(z.string().max(300)).min(2).max(8),
  faq: z
    .array(z.object({ question: z.string().max(300), answer: z.string().max(1200) }))
    .max(8),
  /** Termini definiti nel pezzo: aiutano a farsi riconoscere per argomento. */
  entities: z.array(z.string().max(120)).max(20),
  internalLinkHints: z.array(z.string().max(200)).max(10),
  gaps: z.array(z.string().max(300)).max(10),
});

export type BlogArticleOutput = z.infer<typeof blogArticleOutputSchema>;

// ---------------------------------------------------------------------------
// Derivazioni: corsi
// ---------------------------------------------------------------------------

export const coursePlanInputSchema = z.object({
  projectTitle: z.string().max(300),
  direzione: z.string().max(9000),
  language: z.string().max(20),
  /** Argomento libero, oppure titoli dei capitoli scelti. */
  topic: z.string().max(2000),
  level: z.enum(['base', 'intermediate', 'advanced']),
  format: z.enum(['autoapprendimento', 'aula', 'video']),
  lessonMinutes: z.number().int().min(10).max(240),
  lessonCount: z.number().int().min(1).max(40),
  evidence: z.string(),
});

export type CoursePlanInput = z.infer<typeof coursePlanInputSchema>;

export const coursePlanOutputSchema = z.object({
  title: z.string().min(3).max(200),
  summary: z.string().max(2000),
  prerequisites: z.array(z.string().max(300)).max(10),
  outcomes: z.array(z.string().max(300)).min(2).max(12),
  lessons: z
    .array(
      z.object({
        title: z.string().min(3).max(200),
        intent: z.string().min(10).max(600),
        objectives: z.array(z.string().max(300)).min(1).max(6),
      }),
    )
    .min(1)
    .max(40),
  note: z.string().max(1000),
});

export type CoursePlanOutput = z.infer<typeof coursePlanOutputSchema>;

export const courseLessonInputSchema = coursePlanInputSchema.extend({
  lessonTitle: z.string().max(200),
  lessonIntent: z.string().max(600),
  lessonObjectives: z.array(z.string().max(300)).max(6),
  lessonNumber: z.number().int().positive(),
  outline: z.array(z.string().max(200)).max(40),
});

export type CourseLessonInput = z.infer<typeof courseLessonInputSchema>;

export const courseLessonOutputSchema = z.object({
  contentMd: z.string().min(1),
  gaps: z.array(z.string().max(300)).max(10),
});

export type CourseLessonOutput = z.infer<typeof courseLessonOutputSchema>;
