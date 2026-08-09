import { z } from 'zod';

/**
 * Modelli di dominio delle collane editoriali (Fase 8).
 *
 * Nell'interfaccia italiana il termine è «Collane»; nel codice è `series`.
 *
 * Questo modulo contiene soltanto tipi, stati e schemi di validazione: le
 * fondamenta su cui la Fase 8 costruirà rotte, agenti e workflow. È presente
 * fin d'ora perché il database (migration 13) e la documentazione lo
 * presuppongono, e perché un modello di dominio scritto prima
 * dell'implementazione è più facile da discutere che da correggere.
 */

// ---------------------------------------------------------------------------
// Stati
// ---------------------------------------------------------------------------

export const VOLUME_STATUSES = [
  'planned',
  'draft',
  'in_review',
  'approved',
  'ready_for_publication',
  'published',
  'archived',
] as const;

export type VolumeStatus = (typeof VOLUME_STATUSES)[number];

export const VOLUME_STATUS_LABELS: Record<VolumeStatus, string> = {
  planned: 'Pianificato',
  draft: 'In stesura',
  in_review: 'In revisione',
  approved: 'Approvato',
  ready_for_publication: 'Pronto per la stampa',
  published: 'Pubblicato',
  archived: 'Archiviato',
};

/**
 * Un volume pubblicato non si modifica in silenzio: una copia stampata non si
 * aggiorna. Ogni cambiamento richiede una nuova edizione.
 */
export function isVolumeImmutable(status: VolumeStatus): boolean {
  return status === 'published' || status === 'archived';
}

/** Il riordino libero vale solo prima che il volume esista fisicamente. */
export function canRenumberFreely(status: VolumeStatus): boolean {
  return status === 'planned' || status === 'draft';
}

// ---------------------------------------------------------------------------
// Ereditarietà delle regole
// ---------------------------------------------------------------------------

export const RULE_MODES = ['inherited', 'overridden', 'locked'] as const;
export type RuleMode = (typeof RULE_MODES)[number];

export const RULE_MODE_LABELS: Record<RuleMode, string> = {
  inherited: 'Ereditata dalla collana',
  overridden: 'Variante locale',
  locked: 'Bloccata: non derogabile',
};

/** Ambiti in cui una collana detta regole comuni. */
export const RULE_SCOPES = [
  'editorial_line',
  'tone',
  'terminology',
  'typography',
  'palette',
  'fonts',
  'grid',
  'image_style',
  'diagram_style',
  'cover_template',
  'spine_structure',
  'back_cover_structure',
  'front_matter',
  'back_matter',
  'code_conventions',
  'callout_conventions',
  'citation_format',
  'export_config',
] as const;

export type RuleScope = (typeof RULE_SCOPES)[number];

export const RULE_SCOPE_LABELS: Record<RuleScope, string> = {
  editorial_line: 'Linea editoriale',
  tone: 'Tono',
  terminology: 'Terminologia',
  typography: 'Regole tipografiche',
  palette: 'Palette',
  fonts: 'Font',
  grid: 'Griglia',
  image_style: 'Stile delle immagini',
  diagram_style: 'Stile dei diagrammi',
  cover_template: 'Template della copertina',
  spine_structure: 'Struttura del dorso',
  back_cover_structure: 'Struttura della quarta',
  front_matter: 'Materiale di apertura',
  back_matter: 'Materiale di chiusura',
  code_conventions: 'Convenzioni per il codice',
  callout_conventions: 'Convenzioni per i callout',
  citation_format: 'Formato delle citazioni',
  export_config: 'Configurazioni di esportazione',
};

// ---------------------------------------------------------------------------
// Entità
// ---------------------------------------------------------------------------

export const seriesSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(2).max(200),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  description: z.string().max(3000).nullable(),
  curator: z.string().max(200),
  publisher: z.string().max(200).nullable(),
  audience: z.string().max(300).nullable(),
  subjectArea: z.string().max(200).nullable(),
  language: z.string().regex(/^[a-z]{2}$/),
  logoAssetId: z.string().uuid().nullable(),
});

export type Series = z.infer<typeof seriesSchema>;

export const seriesVolumeSchema = z.object({
  id: z.string().uuid(),
  seriesId: z.string().uuid(),
  /** Univoco nella collana. */
  volumeNumber: z.number().int().positive(),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(300).nullable(),
  authors: z.array(z.string().max(200)).max(20),
  description: z.string().max(3000).nullable(),
  topic: z.string().max(200).nullable(),
  level: z.enum(['introduttivo', 'intermedio', 'avanzato']).nullable(),
  audience: z.string().max(300).nullable(),
  prerequisites: z.array(z.string().max(300)).max(30),
  status: z.enum(VOLUME_STATUSES),
  plannedDate: z.string().nullable(),
  publishedDate: z.string().nullable(),
  isbn: z.string().max(20).nullable(),
  edition: z.number().int().positive(),
  language: z.string().regex(/^[a-z]{2}$/),
  /**
   * Il progetto editoriale collegato, se esiste.
   *
   * Questa è la unica sede della relazione collana-progetto: `projects` non
   * porta `series_id` né `volume_number`. Le ragioni sono in docs/series.md,
   * sezione 4.
   */
  projectId: z.string().uuid().nullable(),
  coverProjectId: z.string().uuid().nullable(),
  finalPageCount: z.number().int().positive().nullable(),
});

export type SeriesVolume = z.infer<typeof seriesVolumeSchema>;

export const crossVolumeRelationSchema = z.enum([
  'requires',
  'deepens',
  'independent',
  'supersedes',
  'complements',
]);

export type CrossVolumeRelation = z.infer<typeof crossVolumeRelationSchema>;

export const CROSS_VOLUME_RELATION_LABELS: Record<CrossVolumeRelation, string> = {
  requires: 'richiede',
  deepens: 'approfondisce',
  independent: 'può essere letto indipendentemente da',
  supersedes: 'sostituisce',
  complements: 'completa',
};

export const seriesTermSchema = z.object({
  id: z.string().uuid(),
  seriesId: z.string().uuid(),
  preferred: z.string().min(1).max(200),
  definition: z.string().max(2000),
  discouraged: z.array(z.string().max(200)).max(20),
  synonyms: z.array(z.string().max(200)).max(20),
  translation: z.string().max(200).nullable(),
  abbreviation: z.string().max(50).nullable(),
  caseSensitive: z.boolean(),
  source: z.string().max(500).nullable(),
  editorialNote: z.string().max(2000).nullable(),
});

export type SeriesTerm = z.infer<typeof seriesTermSchema>;

// ---------------------------------------------------------------------------
// Coerenza
// ---------------------------------------------------------------------------

export const CONSISTENCY_DIMENSIONS = [
  'editorial',
  'terminology',
  'visual',
  'curriculum',
  'technical',
  'cross_reference',
  'technology_version',
  'shared_content',
] as const;

export type ConsistencyDimension = (typeof CONSISTENCY_DIMENSIONS)[number];

export const CONSISTENCY_DIMENSION_LABELS: Record<ConsistencyDimension, string> = {
  editorial: 'Coerenza editoriale',
  terminology: 'Coerenza terminologica',
  visual: 'Coerenza visiva',
  curriculum: 'Coerenza didattica',
  technical: 'Coerenza tecnica',
  cross_reference: 'Riferimenti incrociati',
  technology_version: 'Versioni tecnologiche',
  shared_content: 'Contenuti condivisi obsoleti',
};

/**
 * Una differenza autorizzata è una deroga dichiarata e motivata; una non
 * autorizzata è una divergenza che nessuno ha deciso.
 *
 * Il report deve distinguerle: un elenco che segnala anche le scelte
 * deliberate viene ignorato dopo due settimane.
 */
export const DIFFERENCE_KINDS = ['authorized', 'unauthorized'] as const;
export type DifferenceKind = (typeof DIFFERENCE_KINDS)[number];
