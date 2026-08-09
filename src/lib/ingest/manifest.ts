import { z } from 'zod';
import type { ExtractedFile } from './archive';
import { analyzeMarkdown, slugify, type MarkdownAnalysis } from './markdown';
import {
  compareEditorial,
  humanizeSlug,
  parseEditorialName,
  type EditorialKind,
} from './ordering';

/**
 * Costruzione del manifesto editoriale: la fonte di verità sulla struttura
 * dell'opera.
 *
 * Due regole guidano l'intero modulo:
 *
 *  1. L'ordine viene dai numeri, mai dall'alfabeto. Il capitolo 11 sta dopo il
 *     10, non dopo l'1.
 *  2. Il file indice non viene creduto sulla parola. Viene confrontato con la
 *     struttura reale delle cartelle e ogni differenza viene segnalata, non
 *     risolta in silenzio.
 */

export const manifestChapterSchema = z.object({
  kind: z.enum(['front_matter', 'part', 'appendix', 'back_matter']),
  number: z.number().int().nullable(),
  label: z.string().nullable(),
  title: z.string(),
  slug: z.string(),
  orderIndex: z.number().int(),
  sourcePath: z.string(),
  wordCount: z.number().int().nonnegative(),
  headingCount: z.number().int().nonnegative(),
  codeBlockCount: z.number().int().nonnegative(),
  codeLanguages: z.array(z.string()),
  figureCount: z.number().int().nonnegative(),
  placeholderCount: z.number().int().nonnegative(),
  linkCount: z.number().int().nonnegative(),
  missingFigures: z.array(z.string()),
});

export const manifestPartSchema = z.object({
  kind: z.enum(['front_matter', 'part', 'appendix', 'back_matter']),
  number: z.number().int().nullable(),
  label: z.string().nullable(),
  title: z.string(),
  orderIndex: z.number().int(),
  sourcePath: z.string().nullable(),
  chapters: z.array(manifestChapterSchema),
});

export const manifestDiscrepancySchema = z.object({
  kind: z.enum([
    'capitolo_assente_dall_indice',
    'indice_riferisce_file_inesistente',
    'numerazione_interrotta',
    'numero_duplicato',
    'immagine_mancante',
    'capitolo_senza_titolo',
    'indice_non_trovato',
  ]),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string(),
  path: z.string().nullable(),
});

export const manifestSchema = z.object({
  title: z.string(),
  subtitle: z.string().nullable(),
  author: z.string(),
  volume: z.string().nullable(),
  indexPath: z.string().nullable(),
  parts: z.array(manifestPartSchema),
  stats: z.object({
    partCount: z.number().int().nonnegative(),
    chapterCount: z.number().int().nonnegative(),
    appendixCount: z.number().int().nonnegative(),
    wordCount: z.number().int().nonnegative(),
    codeBlockCount: z.number().int().nonnegative(),
    figureCount: z.number().int().nonnegative(),
    placeholderCount: z.number().int().nonnegative(),
    linkCount: z.number().int().nonnegative(),
    assetCount: z.number().int().nonnegative(),
    missingFigureCount: z.number().int().nonnegative(),
  }),
  discrepancies: z.array(manifestDiscrepancySchema),
});

export type ManifestChapter = z.infer<typeof manifestChapterSchema>;
export type ManifestPart = z.infer<typeof manifestPartSchema>;
export type ManifestDiscrepancy = z.infer<typeof manifestDiscrepancySchema>;
export type EditorialManifest = z.infer<typeof manifestSchema>;

const INDEX_FILENAMES = new Set([
  'readme.md', 'index.md', 'indice.md', 'sommario.md', 'toc.md',
  '_index.md', '00-indice.md', 'summary.md',
]);

interface ChapterDraft {
  kind: EditorialKind;
  number: number | null;
  label: string | null;
  title: string;
  sourcePath: string;
  analysis: MarkdownAnalysis;
  partKey: string;
}

/** Il primo segmento del percorso, se rappresenta una parte editoriale. */
function partKeyOf(file: ExtractedFile): { key: string; rawName: string | null } {
  const segments = file.directory ? file.directory.split('/') : [];
  const first = segments[0];
  if (!first) return { key: '', rawName: null };
  return { key: first, rawName: first };
}

function isIndexFile(file: ExtractedFile): boolean {
  return INDEX_FILENAMES.has(file.filename.toLowerCase());
}

/** Risolve un percorso relativo rispetto alla cartella che lo contiene. */
export function resolveRelativePath(fromDirectory: string, target: string): string {
  const cleaned = target.split(/[?#]/)[0] ?? target;
  if (/^https?:/i.test(cleaned)) return cleaned;

  const base = cleaned.startsWith('/') ? [] : fromDirectory ? fromDirectory.split('/') : [];
  const segments = cleaned.replace(/^\//, '').split('/');
  const stack = [...base];

  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.join('/');
}

export interface BuildManifestOptions {
  title?: string;
  subtitle?: string | null;
  author?: string;
  volume?: string | null;
}

export function buildManifest(
  files: ExtractedFile[],
  options: BuildManifestOptions = {},
): EditorialManifest {
  const usable = files.filter((f) => !f.isIgnored);
  const byPath = new Map(usable.map((f) => [f.normalizedPath, f]));

  const markdownFiles = usable.filter((f) => f.kind === 'markdown' && f.textContent !== null);
  const assetFiles = usable.filter((f) => f.kind !== 'markdown');

  const discrepancies: ManifestDiscrepancy[] = [];

  // -------------------------------------------------------------------------
  // File indice
  // -------------------------------------------------------------------------
  const indexFile =
    markdownFiles.find((f) => isIndexFile(f) && f.directory === '') ??
    markdownFiles.find((f) => isIndexFile(f)) ??
    null;

  const indexAnalysis = indexFile ? analyzeMarkdown(indexFile.textContent!) : null;

  // Percorsi Markdown citati dall'indice, risolti rispetto alla sua cartella.
  const indexReferences = new Set<string>();
  if (indexFile && indexFile.textContent) {
    for (const match of indexFile.textContent.matchAll(/\[[^\]]*\]\(([^)\s]+\.mdx?)\)/gi)) {
      indexReferences.add(resolveRelativePath(indexFile.directory, match[1]!));
    }
  }

  if (!indexFile) {
    discrepancies.push({
      kind: 'indice_non_trovato',
      severity: 'info',
      message:
        'Nessun file indice (README, INDICE, SOMMARIO). La struttura è stata ricavata solo dalle cartelle.',
      path: null,
    });
  }

  // -------------------------------------------------------------------------
  // Capitoli
  // -------------------------------------------------------------------------
  const drafts: ChapterDraft[] = [];

  for (const file of markdownFiles) {
    if (indexFile && file.normalizedPath === indexFile.normalizedPath) continue;

    const analysis = analyzeMarkdown(file.textContent!);
    const parsedFile = parseEditorialName(file.filename);
    const { key, rawName } = partKeyOf(file);
    const parsedDirectory = rawName ? parseEditorialName(rawName) : null;

    // Un file dentro una cartella "appendici" è un'appendice anche se il suo
    // nome non lo dichiara.
    const kind: EditorialKind =
      parsedFile.kind === 'appendix'
        ? 'appendix'
        : parsedDirectory?.kind === 'appendix'
          ? 'appendix'
          : parsedFile.kind;

    const title =
      analysis.title ??
      parsedFile.titleHint ??
      humanizeSlug(file.filename.replace(/\.[^.]+$/, ''));

    if (!analysis.title) {
      discrepancies.push({
        kind: 'capitolo_senza_titolo',
        severity: 'warning',
        message: `«${file.normalizedPath}» non dichiara un titolo di primo livello: usato il nome del file.`,
        path: file.normalizedPath,
      });
    }

    drafts.push({
      kind,
      number: parsedFile.number,
      label: parsedFile.label,
      title,
      sourcePath: file.normalizedPath,
      analysis,
      partKey: key,
    });
  }

  // -------------------------------------------------------------------------
  // Parti
  // -------------------------------------------------------------------------
  const partKeys = [...new Set(drafts.map((d) => d.partKey))];
  const partsMeta = partKeys.map((key) => {
    if (key === '') {
      return { key, kind: 'part' as EditorialKind, number: null, label: null, title: 'Radice', sourcePath: null };
    }
    const parsed = parseEditorialName(key);
    return {
      key,
      kind: parsed.kind,
      number: parsed.number,
      label: parsed.label,
      title: parsed.titleHint ?? humanizeSlug(key),
      sourcePath: key,
    };
  });

  partsMeta.sort((a, b) =>
    compareEditorial(
      { kind: a.kind, number: a.number, title: a.title },
      { kind: b.kind, number: b.number, title: b.title },
    ),
  );

  // -------------------------------------------------------------------------
  // Composizione, con indice d'ordine globale
  // -------------------------------------------------------------------------
  let orderIndex = 0;
  const parts: ManifestPart[] = [];
  const missingFigureTotals: string[] = [];

  for (const meta of partsMeta) {
    const partDrafts = drafts
      .filter((d) => d.partKey === meta.key)
      .sort((a, b) =>
        compareEditorial(
          { kind: a.kind, number: a.number, title: a.title },
          { kind: b.kind, number: b.number, title: b.title },
        ),
      );

    const chapters: ManifestChapter[] = partDrafts.map((draft) => {
      const missing = draft.analysis.figures
        .filter((figure) => !/^https?:/i.test(figure.src))
        .map((figure) => resolveRelativePath(dirnameOf(draft.sourcePath), figure.src))
        .filter((resolved) => !byPath.has(resolved));

      missingFigureTotals.push(...missing);

      const languages = [
        ...new Set(
          draft.analysis.codeBlocks
            .map((block) => block.language)
            .filter((language): language is string => Boolean(language)),
        ),
      ].sort();

      orderIndex += 1;
      return {
        kind: draft.kind,
        number: draft.number,
        label: draft.label,
        title: draft.title,
        slug: slugify(draft.title) || slugify(draft.sourcePath),
        orderIndex,
        sourcePath: draft.sourcePath,
        wordCount: draft.analysis.wordCount,
        headingCount: draft.analysis.headings.length,
        codeBlockCount: draft.analysis.codeBlocks.length,
        codeLanguages: languages,
        figureCount: draft.analysis.figures.length,
        placeholderCount: draft.analysis.placeholders.length,
        linkCount: draft.analysis.links.length,
        missingFigures: missing,
      };
    });

    if (chapters.length === 0) continue;

    parts.push({
      kind: meta.kind,
      number: meta.number,
      label: meta.label,
      title: meta.title,
      orderIndex: parts.length + 1,
      sourcePath: meta.sourcePath,
      chapters,
    });
  }

  // -------------------------------------------------------------------------
  // Confronto fra indice dichiarato e struttura reale
  // -------------------------------------------------------------------------
  const allChapterPaths = new Set(parts.flatMap((p) => p.chapters.map((c) => c.sourcePath)));

  if (indexFile) {
    for (const referenced of indexReferences) {
      if (!byPath.has(referenced)) {
        discrepancies.push({
          kind: 'indice_riferisce_file_inesistente',
          severity: 'error',
          message: `L’indice cita «${referenced}», che non è presente nell’archivio.`,
          path: referenced,
        });
      }
    }

    for (const path of allChapterPaths) {
      if (!indexReferences.has(path)) {
        discrepancies.push({
          kind: 'capitolo_assente_dall_indice',
          severity: 'warning',
          message: `«${path}» esiste nell’archivio ma non compare nell’indice.`,
          path,
        });
      }
    }
  }

  // Numerazione: interruzioni e duplicati, valutati per categoria.
  for (const kind of ['part', 'appendix'] as const) {
    const numbers = parts
      .flatMap((p) => p.chapters)
      .filter((c) => c.kind === kind && c.number !== null)
      .map((c) => c.number!)
      .sort((a, b) => a - b);

    const seen = new Set<number>();
    for (const number of numbers) {
      if (seen.has(number)) {
        discrepancies.push({
          kind: 'numero_duplicato',
          severity: 'error',
          message:
            kind === 'appendix'
              ? `Due appendici hanno lo stesso numero (${number}).`
              : `Due capitoli hanno lo stesso numero (${number}).`,
          path: null,
        });
      }
      seen.add(number);
    }

    const unique = [...seen].sort((a, b) => a - b);
    for (let i = 1; i < unique.length; i += 1) {
      const previous = unique[i - 1]!;
      const current = unique[i]!;
      if (current - previous > 1) {
        discrepancies.push({
          kind: 'numerazione_interrotta',
          severity: 'warning',
          message:
            kind === 'appendix'
              ? `Salto nella numerazione delle appendici fra ${previous} e ${current}.`
              : `Salto nella numerazione dei capitoli fra ${previous} e ${current}.`,
          path: null,
        });
      }
    }
  }

  for (const missing of new Set(missingFigureTotals)) {
    discrepancies.push({
      kind: 'immagine_mancante',
      severity: 'warning',
      message: `L’immagine «${missing}» è citata ma non è presente nell’archivio.`,
      path: missing,
    });
  }

  // -------------------------------------------------------------------------
  // Aggregati
  // -------------------------------------------------------------------------
  const allChapters = parts.flatMap((p) => p.chapters);

  const manifest: EditorialManifest = {
    title:
      options.title ??
      indexAnalysis?.title ??
      indexAnalysis?.frontMatter.title ??
      'Manuale senza titolo',
    subtitle: options.subtitle ?? indexAnalysis?.frontMatter.subtitle ?? null,
    author: options.author ?? indexAnalysis?.frontMatter.author ?? '',
    volume: options.volume ?? indexAnalysis?.frontMatter.volume ?? null,
    indexPath: indexFile?.normalizedPath ?? null,
    parts,
    stats: {
      partCount: parts.filter((p) => p.kind === 'part').length,
      chapterCount: allChapters.filter((c) => c.kind === 'part').length,
      appendixCount: allChapters.filter((c) => c.kind === 'appendix').length,
      wordCount: allChapters.reduce((sum, c) => sum + c.wordCount, 0),
      codeBlockCount: allChapters.reduce((sum, c) => sum + c.codeBlockCount, 0),
      figureCount: allChapters.reduce((sum, c) => sum + c.figureCount, 0),
      placeholderCount: allChapters.reduce((sum, c) => sum + c.placeholderCount, 0),
      linkCount: allChapters.reduce((sum, c) => sum + c.linkCount, 0),
      assetCount: assetFiles.length,
      missingFigureCount: new Set(missingFigureTotals).size,
    },
    discrepancies,
  };

  return manifestSchema.parse(manifest);
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}
