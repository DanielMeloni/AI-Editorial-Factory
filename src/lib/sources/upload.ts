import { z } from 'zod';

/**
 * Validazione della richiesta di caricamento.
 *
 * L'archivio NON transita dal server applicativo: una Vercel Function accetta
 * al massimo circa 4,5 MB di corpo, mentre un manuale con PDF e immagini ne
 * pesa molti di più. Il browser carica direttamente su Supabase Storage
 * usando un URL firmato che il server emette solo dopo aver verificato
 * l'appartenenza all'organizzazione.
 */

export const MAX_UPLOAD_BYTES = 1_073_741_824; // 1 GiB, allineato al bucket

const ACCEPTED_MIME = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream', // alcuni browser non riconoscono lo ZIP
  '',
]);

export const uploadRequestSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1, 'Nome file mancante')
    .max(255, 'Nome file troppo lungo')
    .refine((name) => name.toLowerCase().endsWith('.zip'), 'Sono ammessi solo archivi .zip')
    .refine((name) => !name.includes('/') && !name.includes('\\'), 'Il nome non può contenere percorsi')
    .refine((name) => !name.includes('\0'), 'Nome file non valido'),
  byteSize: z
    .number()
    .int()
    .positive('L’archivio è vuoto')
    .max(MAX_UPLOAD_BYTES, 'L’archivio supera il limite di 1 GiB'),
  mimeType: z
    .string()
    .max(200)
    .refine((type) => ACCEPTED_MIME.has(type), 'Tipo di file non ammesso'),
});

export type UploadRequest = z.infer<typeof uploadRequestSchema>;

/** Ripulisce il nome per l'archiviazione, senza fidarsi di quello ricevuto. */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'archivio.zip';
  return (
    base
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 120) || 'archivio.zip'
  );
}

/**
 * Percorso di conservazione. Il primo segmento è sempre l'organizzazione:
 * le policy dello storage decidono in base a quello.
 */
export function buildSourceStoragePath(
  organizationId: string,
  projectId: string,
  sourceId: string,
  filename: string,
): string {
  return `${organizationId}/${projectId}/sources/${sourceId}/${sanitizeFilename(filename)}`;
}

/** I byte iniziali di un file ZIP: 'PK\x03\x04'. */
export function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}
