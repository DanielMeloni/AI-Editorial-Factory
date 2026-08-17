import { z } from 'zod';
import { tokenize } from './match';
import type { SearchableEntry } from './match';

/**
 * La biblioteca delle fonti: link e PDF aggiunti a mano.
 *
 * L'indice ufficiale copre la documentazione del produttore. Un manuale però si
 * appoggia anche ad altro — una specifica, una norma, un articolo, un documento
 * interno — e quel materiale merita lo stesso trattamento: viene indicizzato, e
 * la ricerca automatica lo propone.
 *
 * Quello che **non** succede è la confusione fra i due: l'origine resta scritta
 * su ogni proposta, e una fonte della biblioteca pesa meno della documentazione
 * del produttore — a meno che l'autore non l'abbia dichiarata autorevole, perché
 * una norma ISO non è un post di un blog.
 */

// ---------------------------------------------------------------------------
// Limiti
// ---------------------------------------------------------------------------

/** Un PDF di riferimento: 100 MiB bastano a una specifica, non a un archivio. */
export const MAX_PDF_BYTES = 104_857_600;

/** Blocchi indicizzabili per fonte. Oltre, il documento va diviso. */
export const MAX_CHUNKS_PER_REFERENCE = 2_000;

/** Caratteri per blocco: abbastanza per un concetto, non per un capitolo. */
export const CHUNK_TARGET_CHARS = 1_200;

/** Testo raccolto da una pagina web. Oltre, si tronca dichiarandolo. */
export const MAX_LINK_CHARS = 200_000;

// ---------------------------------------------------------------------------
// Validazione
// ---------------------------------------------------------------------------

export const referenceKindSchema = z.enum(['link', 'pdf']);
export const referenceScopeSchema = z.enum(['organization', 'project']);
export const referenceStatusSchema = z.enum(['pending', 'indexing', 'indexed', 'failed']);

export type ReferenceKind = z.infer<typeof referenceKindSchema>;
export type ReferenceScope = z.infer<typeof referenceScopeSchema>;
export type ReferenceStatus = z.infer<typeof referenceStatusSchema>;

/** Un indirizzo aggiunto a mano. Il titolo è obbligatorio: senza, l'elenco è illeggibile. */
export const addLinkSchema = z.object({
  projectId: z.string().uuid(),
  url: z
    .url({ error: 'Inserire un indirizzo completo, con https://' })
    .max(2000, 'Indirizzo troppo lungo')
    .refine((value) => /^https?:\/\//i.test(value), 'Sono ammessi solo indirizzi http o https'),
  title: z.string().trim().min(1, 'Il titolo è obbligatorio').max(300, 'Titolo troppo lungo'),
  note: z.string().trim().max(1000, 'Nota troppo lunga').optional(),
  /** Vale quanto la documentazione ufficiale: lo decide chi scrive, non il sistema. */
  isAuthoritative: z.boolean().default(false),
  /** Visibile a tutti i progetti dell'organizzazione, o solo a questo. */
  scope: referenceScopeSchema.default('project'),
});

export type AddLinkInput = z.input<typeof addLinkSchema>;

export const addPdfSchema = z.object({
  projectId: z.string().uuid(),
  filename: z
    .string()
    .trim()
    .min(1, 'Nome file mancante')
    .max(255, 'Nome file troppo lungo')
    .refine((name) => name.toLowerCase().endsWith('.pdf'), 'Sono ammessi solo file .pdf')
    .refine((name) => !name.includes('/') && !name.includes('\\'), 'Il nome non può contenere percorsi')
    .refine((name) => !name.includes('\0'), 'Nome file non valido'),
  byteSize: z
    .number()
    .int()
    .positive('Il file è vuoto')
    .max(MAX_PDF_BYTES, 'Il PDF supera il limite di 100 MiB'),
  title: z.string().trim().min(1, 'Il titolo è obbligatorio').max(300, 'Titolo troppo lungo'),
  note: z.string().trim().max(1000, 'Nota troppo lunga').optional(),
  isAuthoritative: z.boolean().default(false),
  scope: referenceScopeSchema.default('project'),
});

export type AddPdfInput = z.input<typeof addPdfSchema>;

/** Ripulisce il nome per l'archiviazione, senza fidarsi di quello ricevuto. */
export function sanitizePdfName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'documento.pdf';
  return (
    base
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 120) || 'documento.pdf'
  );
}

/**
 * Percorso di conservazione. Il primo segmento è sempre l'organizzazione: le
 * policy dello storage decidono in base a quello, senza interrogare altre tabelle.
 */
export function buildReferenceStoragePath(
  organizationId: string,
  projectId: string,
  referenceId: string,
  filename: string,
): string {
  return `${organizationId}/${projectId}/references/${referenceId}/${sanitizePdfName(filename)}`;
}

/** I byte iniziali di un PDF: '%PDF'. */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

// ---------------------------------------------------------------------------
// Suddivisione in blocchi
// ---------------------------------------------------------------------------

export interface ReferenceChunk {
  chunkIndex: number;
  /** Pagina del PDF. Nullo per i link, che non ne hanno. */
  page: number | null;
  heading: string | null;
  content: string;
  /** Termini canonici, calcolati una volta e conservati. */
  terms: string[];
}

/** Riduce gli spazi senza toccare i capoversi: il testo resta leggibile. */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Divide un testo in blocchi di dimensione simile, spezzando sui capoversi.
 *
 * Il taglio non cade mai a metà di una frase se può evitarlo: un blocco che
 * inizia a metà di un ragionamento produce proposte incomprensibili quando
 * finisce sotto gli occhi di un revisore.
 */
export function splitIntoChunks(
  text: string,
  options: { page?: number | null; startIndex?: number; heading?: string | null } = {},
): ReferenceChunk[] {
  const normalized = normalizeWhitespace(text);
  if (normalized.length === 0) return [];

  const paragraphs = normalized.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const chunks: ReferenceChunk[] = [];

  let buffer = '';
  let index = options.startIndex ?? 0;

  const flush = () => {
    const content = buffer.trim();
    buffer = '';
    if (content.length < 20) return;
    chunks.push({
      chunkIndex: index++,
      page: options.page ?? null,
      heading: options.heading ?? null,
      content: content.slice(0, CHUNK_TARGET_CHARS * 2),
      terms: [...new Set(tokenize(content))],
    });
  };

  for (const paragraph of paragraphs) {
    if (buffer.length > 0 && buffer.length + paragraph.length > CHUNK_TARGET_CHARS) flush();

    // Un capoverso più lungo di un blocco viene spezzato sulle frasi.
    if (paragraph.length > CHUNK_TARGET_CHARS * 2) {
      for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
        if (buffer.length + sentence.length > CHUNK_TARGET_CHARS) flush();
        buffer += (buffer ? ' ' : '') + sentence;
      }
      continue;
    }

    buffer += (buffer ? '\n\n' : '') + paragraph;
  }

  flush();
  return chunks;
}

// ---------------------------------------------------------------------------
// Dalla biblioteca all'indice
// ---------------------------------------------------------------------------

export interface ReferenceForIndex {
  id: string;
  title: string;
  kind: ReferenceKind;
  url: string | null;
  isAuthoritative: boolean;
  scope: ReferenceScope;
}

/**
 * Peso di una fonte della biblioteca rispetto alla documentazione ufficiale.
 *
 * Una fonte dichiarata autorevole dall'autore — una specifica, una norma —
 * vale quanto la documentazione del produttore. Le altre valgono meno: restano
 * proponibili, ma non scavalcano la fonte primaria a parità di pertinenza.
 */
export const LIBRARY_WEIGHT = 0.85;
export const AUTHORITATIVE_WEIGHT = 1;

/** Trasforma i blocchi di una fonte in voci interrogabili. */
export function referenceEntries(
  reference: ReferenceForIndex,
  chunks: readonly ReferenceChunk[],
): SearchableEntry[] {
  const weight = reference.isAuthoritative ? AUTHORITATIVE_WEIGHT : LIBRARY_WEIGHT;

  return chunks.map((chunk) => ({
    url: reference.url,
    title: reference.title,
    section:
      chunk.page !== null
        ? `Pagina ${chunk.page}`
        : (chunk.heading ?? (reference.kind === 'link' ? 'Pagina web' : 'Documento')),
    product: null,
    origin: 'biblioteca' as const,
    referenceId: reference.id,
    page: chunk.page,
    topics: chunk.terms,
    weight,
  }));
}
