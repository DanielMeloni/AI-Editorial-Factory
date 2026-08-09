import { unzipSync } from 'fflate';
import { classifyFile, isTextExtension, looksLikeText, type SourceFileKind } from './classify';
import { DEFAULT_INGEST_LIMITS, ALLOWED_EXTENSIONS, type IngestLimits } from './limits';
import { PATH_REJECTION_MESSAGES, checkArchivePath, shouldIgnorePath } from './path-guard';

/**
 * Estrazione di un archivio ZIP.
 *
 * Ordine delle operazioni, deliberato:
 *   1. si legge l'indice dell'archivio SENZA decomprimere nulla;
 *   2. si verificano percorsi, dimensioni, numero di voci e rapporto di
 *      compressione;
 *   3. si decomprimono soltanto le voci sopravvissute alla verifica.
 *
 * Così un archivio ostile viene fermato prima di occupare memoria, e un errore
 * su un singolo file non compromette l'intera importazione.
 */

export interface ExtractedFile {
  originalPath: string;
  normalizedPath: string;
  directory: string;
  filename: string;
  extension: string;
  kind: SourceFileKind;
  byteSize: number;
  sha256: string;
  /** Valorizzato solo per i file testuali entro il limite configurato. */
  textContent: string | null;
  bytes: Uint8Array | null;
  wordCount: number;
  lineCount: number;
  isIgnored: boolean;
  ignoreReason: string | null;
}

export interface ExtractionError {
  path: string;
  reason: string;
  detail?: string;
}

export interface ExtractionResult {
  files: ExtractedFile[];
  errors: ExtractionError[];
  stats: {
    entriesInArchive: number;
    extracted: number;
    ignored: number;
    rejected: number;
    totalUncompressedBytes: number;
  };
}

export class ArchiveRejectedError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'archivio_troppo_grande'
      | 'troppe_voci'
      | 'contenuto_troppo_grande'
      | 'rapporto_compressione_sospetto'
      | 'archivio_illeggibile'
      | 'archivio_vuoto',
  ) {
    super(message);
    this.name = 'ArchiveRejectedError';
  }
}

interface EntryMetadata {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

/** Legge l'indice dell'archivio senza decomprimere alcuna voce. */
function readIndex(data: Uint8Array): EntryMetadata[] {
  const entries: EntryMetadata[] = [];
  try {
    unzipSync(data, {
      filter(file) {
        entries.push({
          name: file.name,
          compressedSize: file.size,
          uncompressedSize: file.originalSize,
        });
        return false; // nessuna decompressione in questa fase
      },
    });
  } catch (error) {
    throw new ArchiveRejectedError(
      `Archivio non leggibile: ${(error as Error).message}`,
      'archivio_illeggibile',
    );
  }
  return entries;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Conteggio parole tollerante: separa su spazi e punteggiatura. */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return matches ? matches.length : 0;
}

export async function extractArchive(
  data: Uint8Array,
  options: { limits?: Partial<IngestLimits>; keepBinaries?: boolean } = {},
): Promise<ExtractionResult> {
  const limits: IngestLimits = { ...DEFAULT_INGEST_LIMITS, ...options.limits };
  const keepBinaries = options.keepBinaries ?? true;

  if (data.byteLength === 0) {
    throw new ArchiveRejectedError('L’archivio è vuoto.', 'archivio_vuoto');
  }
  if (data.byteLength > limits.maxArchiveBytes) {
    throw new ArchiveRejectedError(
      `L’archivio supera il limite di ${limits.maxArchiveBytes} byte.`,
      'archivio_troppo_grande',
    );
  }

  const index = readIndex(data);

  // Le cartelle compaiono come voci a dimensione nulla con nome terminante in '/'.
  const fileEntries = index.filter((entry) => !entry.name.endsWith('/'));

  if (fileEntries.length === 0) {
    throw new ArchiveRejectedError('L’archivio non contiene file.', 'archivio_vuoto');
  }
  if (fileEntries.length > limits.maxEntries) {
    throw new ArchiveRejectedError(
      `L’archivio contiene ${fileEntries.length} voci, oltre il limite di ${limits.maxEntries}.`,
      'troppe_voci',
    );
  }

  const totalUncompressed = fileEntries.reduce((sum, e) => sum + e.uncompressedSize, 0);
  if (totalUncompressed > limits.maxTotalUncompressedBytes) {
    throw new ArchiveRejectedError(
      `Il contenuto decompresso (${totalUncompressed} byte) supera il limite consentito.`,
      'contenuto_troppo_grande',
    );
  }

  const ratio = totalUncompressed / Math.max(data.byteLength, 1);
  if (ratio > limits.maxCompressionRatio) {
    throw new ArchiveRejectedError(
      `Rapporto di compressione ${ratio.toFixed(1)}× oltre il limite di ${limits.maxCompressionRatio}×: ` +
        'l’archivio potrebbe essere costruito per esaurire la memoria.',
      'rapporto_compressione_sospetto',
    );
  }

  // ---------------------------------------------------------------------
  // Verifica dei percorsi, prima di qualsiasi decompressione
  // ---------------------------------------------------------------------
  const errors: ExtractionError[] = [];
  const accepted = new Map<
    string,
    { normalized: string; directory: string; filename: string; extension: string; ignore: boolean; ignoreReason: string | null }
  >();
  let rejected = 0;

  for (const entry of fileEntries) {
    const check = checkArchivePath(entry.name, limits);
    if (!check.ok) {
      rejected += 1;
      errors.push({ path: entry.name, reason: PATH_REJECTION_MESSAGES[check.reason] });
      continue;
    }

    if (entry.uncompressedSize > limits.maxFileBytes) {
      rejected += 1;
      errors.push({
        path: entry.name,
        reason: 'File oltre la dimensione massima consentita',
        detail: `${entry.uncompressedSize} byte`,
      });
      continue;
    }

    const ignored = shouldIgnorePath(check.normalized);
    const extensionAllowed = check.extension === '' || ALLOWED_EXTENSIONS.has(check.extension);

    accepted.set(entry.name, {
      normalized: check.normalized,
      directory: check.directory,
      filename: check.filename,
      extension: check.extension,
      ignore: ignored.ignore || !extensionAllowed,
      ignoreReason: ignored.ignore
        ? (ignored.reason ?? 'File di sistema')
        : extensionAllowed
          ? null
          : `Estensione non gestita: .${check.extension}`,
    });
  }

  if (accepted.size === 0) {
    return {
      files: [],
      errors,
      stats: {
        entriesInArchive: fileEntries.length,
        extracted: 0,
        ignored: 0,
        rejected,
        totalUncompressedBytes: 0,
      },
    };
  }

  // ---------------------------------------------------------------------
  // Decompressione delle sole voci accettate
  // ---------------------------------------------------------------------
  let decompressed: Record<string, Uint8Array>;
  try {
    decompressed = unzipSync(data, { filter: (file) => accepted.has(file.name) });
  } catch (error) {
    throw new ArchiveRejectedError(
      `Decompressione fallita: ${(error as Error).message}`,
      'archivio_illeggibile',
    );
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const files: ExtractedFile[] = [];
  const seenPaths = new Set<string>();
  let ignoredCount = 0;
  let extractedBytes = 0;

  for (const [originalPath, meta] of accepted) {
    const bytes = decompressed[originalPath];
    if (!bytes) {
      errors.push({ path: originalPath, reason: 'Voce assente dopo la decompressione' });
      continue;
    }

    // Due voci diverse possono normalizzarsi allo stesso percorso.
    if (seenPaths.has(meta.normalized)) {
      errors.push({
        path: originalPath,
        reason: 'Percorso duplicato dopo la normalizzazione',
        detail: meta.normalized,
      });
      continue;
    }
    seenPaths.add(meta.normalized);

    try {
      const sha256 = await sha256Hex(bytes);
      const kind = classifyFile(meta.extension, meta.filename);

      const wantsText =
        !meta.ignore &&
        isTextExtension(meta.extension) &&
        bytes.byteLength <= limits.maxTextContentBytes &&
        looksLikeText(bytes);

      const textContent = wantsText ? decoder.decode(bytes) : null;

      files.push({
        originalPath,
        normalizedPath: meta.normalized,
        directory: meta.directory,
        filename: meta.filename,
        extension: meta.extension,
        kind,
        byteSize: bytes.byteLength,
        sha256,
        textContent,
        bytes: keepBinaries && !meta.ignore && textContent === null ? bytes : null,
        wordCount: textContent ? countWords(textContent) : 0,
        lineCount: textContent ? textContent.split('\n').length : 0,
        isIgnored: meta.ignore,
        ignoreReason: meta.ignoreReason,
      });

      if (meta.ignore) ignoredCount += 1;
      extractedBytes += bytes.byteLength;
    } catch (error) {
      // Un errore su un singolo file non compromette l'intera importazione.
      errors.push({
        path: originalPath,
        reason: 'Elaborazione del file fallita',
        detail: (error as Error).message,
      });
    }
  }

  files.sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath, 'it'));

  return {
    files,
    errors,
    stats: {
      entriesInArchive: fileEntries.length,
      extracted: files.filter((f) => !f.isIgnored).length,
      ignored: ignoredCount,
      rejected,
      totalUncompressedBytes: extractedBytes,
    },
  };
}
