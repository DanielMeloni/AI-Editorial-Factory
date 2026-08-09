import { IGNORED_DIRECTORIES, IGNORED_FILENAMES, type IngestLimits } from './limits';

/**
 * Verifica dei percorsi contenuti in un archivio.
 *
 * Un file ZIP dichiara il percorso di ogni voce, e quel percorso è controllato
 * da chi ha creato l'archivio. Un archivio malevolo può dichiarare
 * `../../../etc/passwd` oppure `/etc/cron.d/backdoor` e indurre un
 * estrattore ingenuo a scrivere fuori dalla cartella di destinazione: è la
 * vulnerabilità nota come ZIP Slip.
 *
 * Questo modulo rifiuta simili percorsi PRIMA di qualsiasi lettura del
 * contenuto. L'applicazione non scrive comunque sul filesystem — i file
 * finiscono nel database e su Supabase Storage — ma il controllo resta la
 * prima linea di difesa e impedisce che un percorso ostile si propaghi.
 */

export type PathRejectionReason =
  | 'percorso_vuoto'
  | 'percorso_assoluto'
  | 'unita_windows'
  | 'attraversamento'
  | 'byte_nullo'
  | 'carattere_di_controllo'
  | 'percorso_troppo_lungo'
  | 'annidamento_eccessivo'
  | 'nome_riservato';

export const PATH_REJECTION_MESSAGES: Record<PathRejectionReason, string> = {
  percorso_vuoto: 'Percorso vuoto o composto solo da separatori',
  percorso_assoluto: 'Percorso assoluto non ammesso',
  unita_windows: 'Percorso con unità Windows non ammesso',
  attraversamento: 'Tentativo di uscire dalla cartella di destinazione (ZIP Slip)',
  byte_nullo: 'Il percorso contiene un byte nullo',
  carattere_di_controllo: 'Il percorso contiene caratteri di controllo',
  percorso_troppo_lungo: 'Percorso oltre la lunghezza massima consentita',
  annidamento_eccessivo: 'Cartelle annidate oltre il limite consentito',
  nome_riservato: 'Nome di file riservato dal sistema operativo',
};

export type PathCheck =
  | { ok: true; normalized: string; directory: string; filename: string; extension: string }
  | { ok: false; reason: PathRejectionReason };

// Nomi riservati da Windows, in qualunque combinazione di maiuscole.
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Normalizza e verifica un percorso proveniente da un archivio.
 * Non risolve mai il percorso rispetto al filesystem reale.
 */
export function checkArchivePath(rawPath: string, limits: IngestLimits): PathCheck {
  if (rawPath.includes('\0')) return { ok: false, reason: 'byte_nullo' };

  // I caratteri di controllo non hanno alcun uso legittimo in un percorso.
  for (const char of rawPath) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return { ok: false, reason: 'carattere_di_controllo' };
  }

  if (rawPath.length > limits.maxPathLength) {
    return { ok: false, reason: 'percorso_troppo_lungo' };
  }

  // Gli archivi creati su Windows usano la barra rovesciata.
  const unified = rawPath.replace(/\\/g, '/');

  // C:/... oppure \\server\condivisione
  if (/^[a-zA-Z]:/.test(unified)) return { ok: false, reason: 'unita_windows' };
  if (unified.startsWith('//')) return { ok: false, reason: 'percorso_assoluto' };
  if (unified.startsWith('/')) return { ok: false, reason: 'percorso_assoluto' };

  const rawSegments = unified.split('/');
  const segments: string[] = [];

  for (const segment of rawSegments) {
    if (segment === '' || segment === '.') continue;

    // Nessuna risalita è ammessa, nemmeno se "bilanciata" da un segmento
    // precedente: `a/../b` è legittimo per un filesystem, ma in un archivio
    // editoriale è un segnale di manipolazione, non un percorso normale.
    if (segment === '..') return { ok: false, reason: 'attraversamento' };

    segments.push(segment);
  }

  if (segments.length === 0) return { ok: false, reason: 'percorso_vuoto' };
  if (segments.length > limits.maxPathDepth) return { ok: false, reason: 'annidamento_eccessivo' };

  const filename = segments[segments.length - 1]!;
  const baseName = filename.split('.')[0]?.toLowerCase() ?? '';
  if (WINDOWS_RESERVED.has(baseName)) return { ok: false, reason: 'nome_riservato' };

  const normalized = segments.join('/');
  const directory = segments.slice(0, -1).join('/');
  const dotIndex = filename.lastIndexOf('.');
  const extension = dotIndex > 0 ? filename.slice(dotIndex + 1).toLowerCase() : '';

  return { ok: true, normalized, directory, filename, extension };
}

/**
 * Un file da saltare senza segnalare un errore: artefatti di sistema,
 * cartelle di build, metadati del sistema operativo.
 */
export function shouldIgnorePath(normalizedPath: string): { ignore: boolean; reason?: string } {
  const segments = normalizedPath.split('/');
  const filename = segments[segments.length - 1]!.toLowerCase();

  for (const segment of segments.slice(0, -1)) {
    if (IGNORED_DIRECTORIES.has(segment.toLowerCase())) {
      return { ignore: true, reason: `Cartella di sistema: ${segment}` };
    }
  }

  if (IGNORED_FILENAMES.has(filename)) {
    return { ignore: true, reason: 'File di sistema o di configurazione' };
  }

  // File temporanei degli editor e risorse macOS.
  if (filename.startsWith('._')) return { ignore: true, reason: 'Risorsa macOS' };
  if (filename.startsWith('~$')) return { ignore: true, reason: 'File temporaneo di Office' };
  if (filename.endsWith('~')) return { ignore: true, reason: 'File di backup dell’editor' };
  if (filename.endsWith('.tmp') || filename.endsWith('.temp')) {
    return { ignore: true, reason: 'File temporaneo' };
  }
  if (filename.endsWith('.swp') || filename.endsWith('.swo')) {
    return { ignore: true, reason: 'File di scambio di Vim' };
  }

  return { ignore: false };
}
