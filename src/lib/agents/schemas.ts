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

export const sourceAuditOutputSchema = z.object({
  citations: z.array(
    z.object({
      url: z.string(),
      line: z.number().int().nonnegative(),
      text: z.string().max(300),
      isOfficial: z.boolean(),
      domain: z.string(),
      note: z.string().max(500).nullable(),
    }),
  ).max(200),
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
      kind: z.enum(['linguaggio_codice', 'testo_alternativo', 'nota_verifica', 'terminologia', 'struttura']),
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
  }),
});

export type ChapterAudit = z.infer<typeof chapterAuditSchema>;
