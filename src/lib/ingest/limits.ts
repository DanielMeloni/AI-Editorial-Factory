import { z } from 'zod';

/**
 * Limiti dell'importazione. Configurabili: un manuale di 120.000 parole con
 * PDF e immagini ha esigenze diverse da un archivio di appunti.
 */
export const ingestLimitsSchema = z.object({
  /** Dimensione massima dell'archivio compresso. */
  maxArchiveBytes: z.number().int().positive(),
  /** Somma massima dei file decompressi: prima difesa contro le zip bomb. */
  maxTotalUncompressedBytes: z.number().int().positive(),
  /** Dimensione massima di un singolo file estratto. */
  maxFileBytes: z.number().int().positive(),
  /** Numero massimo di voci nell'archivio. */
  maxEntries: z.number().int().positive(),
  /**
   * Rapporto massimo fra dimensione decompressa e compressa dell'intero
   * archivio. Un ZIP di testo comprime circa 3-5×; oltre 200× si tratta quasi
   * certamente di un archivio costruito per esaurire la memoria.
   */
  maxCompressionRatio: z.number().positive(),
  /** Lunghezza massima del percorso di una voce. */
  maxPathLength: z.number().int().positive(),
  /** Profondità massima di annidamento delle cartelle. */
  maxPathDepth: z.number().int().positive(),
  /** Oltre questa soglia un file testuale non viene conservato per intero. */
  maxTextContentBytes: z.number().int().positive(),
});

export type IngestLimits = z.infer<typeof ingestLimitsSchema>;

export const DEFAULT_INGEST_LIMITS: IngestLimits = {
  maxArchiveBytes: 1_073_741_824, // 1 GiB, allineato al limite del bucket
  maxTotalUncompressedBytes: 2_147_483_648, // 2 GiB
  maxFileBytes: 104_857_600, // 100 MiB
  maxEntries: 20_000,
  maxCompressionRatio: 200,
  maxPathLength: 400,
  maxPathDepth: 20,
  maxTextContentBytes: 4_194_304, // 4 MiB
};

/** Estensioni ammesse: tutto il resto viene ignorato, non rifiutato. */
export const ALLOWED_EXTENSIONS = new Set([
  // editoriale
  'md', 'markdown', 'mdx', 'txt', 'rst', 'adoc', 'tex', 'bib',
  // dati e configurazione
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'xml',
  // codice (trattato sempre come testo, mai eseguito)
  'sql', 'sqlx', 'js', 'mjs', 'cjs', 'ts', 'py', 'sh', 'ps1', 'r', 'ipynb',
  // immagini
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'tif', 'tiff',
  // documenti
  'pdf', 'epub', 'docx', 'odt',
  // font e altro materiale di stampa
  'ttf', 'otf', 'woff', 'woff2',
]);

/** Nomi e cartelle di sistema o temporanei da ignorare in silenzio. */
export const IGNORED_FILENAMES = new Set([
  '.ds_store', 'thumbs.db', 'desktop.ini', '.gitkeep', '.gitignore',
  '.gitattributes', '.editorconfig', '.npmrc', '.env', '.env.local',
]);

export const IGNORED_DIRECTORIES = new Set([
  '__macosx', '.git', '.svn', '.hg', 'node_modules', '.venv', 'venv',
  '__pycache__', '.idea', '.vscode', '.next', 'dist', 'build', '.cache',
  '.pytest_cache', '.mypy_cache', '.ipynb_checkpoints',
]);
