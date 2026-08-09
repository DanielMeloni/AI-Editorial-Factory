/** Classificazione dei file estratti in categorie editoriali. */

export type SourceFileKind =
  | 'markdown' | 'pdf' | 'image' | 'code' | 'data' | 'config' | 'script' | 'archive' | 'other';

const BY_EXTENSION: Record<string, SourceFileKind> = {
  // Solo i formati che l'applicazione tratta come capitoli editoriali.
  // .txt, .rst, .adoc e .tex restano testo leggibile ma non diventano
  // capitoli: un preambolo LaTeX classificato come Markdown finirebbe
  // nell'indice dell'opera come capitolo inesistente.
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  rst: 'other', adoc: 'other', txt: 'other', tex: 'other',

  pdf: 'pdf', epub: 'pdf', docx: 'pdf', odt: 'pdf',

  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  svg: 'image', avif: 'image', tif: 'image', tiff: 'image',

  sql: 'code', sqlx: 'code', js: 'code', mjs: 'code', cjs: 'code',
  ts: 'code', r: 'code', ipynb: 'code',

  py: 'script', sh: 'script', ps1: 'script',

  json: 'data', jsonc: 'data', csv: 'data', tsv: 'data', xml: 'data', bib: 'data',

  yaml: 'config', yml: 'config', toml: 'config',

  zip: 'archive', tar: 'archive', gz: 'archive', rar: 'archive', '7z': 'archive',
};

/** Estensioni il cui contenuto viene conservato come testo. */
const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'rst', 'adoc', 'tex', 'bib',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'xml', 'svg',
  'sql', 'sqlx', 'js', 'mjs', 'cjs', 'ts', 'py', 'sh', 'ps1', 'r', 'ipynb',
]);

export function classifyFile(extension: string, filename: string): SourceFileKind {
  const ext = extension.toLowerCase();

  // Alcuni file di configurazione non hanno estensione.
  if (ext === '') {
    const lower = filename.toLowerCase();
    if (lower === 'dockerfile' || lower === 'makefile' || lower.startsWith('.')) return 'config';
    return 'other';
  }

  return BY_EXTENSION[ext] ?? 'other';
}

/**
 * Un file è trattato come testo in base all'estensione, mai eseguito.
 * `.py`, `.js`, `.sql` e `.sqlx` restano dati inerti: vengono letti,
 * analizzati e mostrati, mai interpretati dal server.
 */
export function isTextExtension(extension: string): boolean {
  return TEXT_EXTENSIONS.has(extension.toLowerCase());
}

/**
 * Verifica che un buffer dichiarato testuale non contenga byte nulli.
 * Un file binario con estensione ingannevole verrebbe altrimenti salvato
 * come testo e corromperebbe le analisi successive.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sampleSize = Math.min(bytes.length, 8192);
  for (let i = 0; i < sampleSize; i += 1) {
    if (bytes[i] === 0) return false;
  }
  return true;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain',
  json: 'application/json', csv: 'text/csv', yaml: 'application/yaml', yml: 'application/yaml',
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif',
  sql: 'text/plain', sqlx: 'text/plain', js: 'text/plain', ts: 'text/plain', py: 'text/plain',
};

/**
 * Tipo MIME usato per la conservazione. I file di codice sono deliberatamente
 * dichiarati `text/plain`: nessun browser deve poterli interpretare.
 */
export function mimeForExtension(extension: string): string {
  return MIME_BY_EXTENSION[extension.toLowerCase()] ?? 'application/octet-stream';
}
