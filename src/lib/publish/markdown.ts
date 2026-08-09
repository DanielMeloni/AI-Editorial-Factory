import { z } from 'zod';
import { analyzeMarkdown } from '@/lib/ingest/markdown';

/**
 * Esportazione in Markdown.
 *
 * Il Markdown è il formato editoriale principale: tutti gli altri ne derivano.
 * L'esportazione normalizza ciò che è meccanico — front matter, numerazione
 * delle figure, sezione dei riferimenti — senza mai riscrivere il testo.
 */

export const exportMetaSchema = z.object({
  title: z.string().min(1),
  chapterNumber: z.number().int().nullable(),
  chapterLabel: z.string().nullable(),
  author: z.string(),
  projectTitle: z.string(),
  volume: z.string().nullable(),
  versionNo: z.number().int().positive(),
  exportedAt: z.string(),
});

export type ExportMeta = z.infer<typeof exportMetaSchema>;

export interface Citation {
  url: string;
  title: string | null;
  publisher: string | null;
  isOfficial: boolean;
}

export interface MarkdownExportOptions {
  /** Antepone il front matter YAML con i metadati. */
  includeFrontMatter?: boolean;
  /** Numera le figure e allinea le didascalie. */
  numberFigures?: boolean;
  /** Aggiunge in coda la sezione dei riferimenti. */
  citations?: Citation[];
}

function yamlValue(value: string): string {
  // Le stringhe che contengono due punti o virgolette vanno quotate.
  return /[:#"'\n]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

export function buildFrontMatter(meta: ExportMeta): string {
  const righe = [
    '---',
    `title: ${yamlValue(meta.title)}`,
    `author: ${yamlValue(meta.author)}`,
    `opera: ${yamlValue(meta.projectTitle)}`,
  ];

  if (meta.volume) righe.push(`volume: ${yamlValue(meta.volume)}`);
  if (meta.chapterLabel) righe.push(`capitolo: ${yamlValue(meta.chapterLabel)}`);
  righe.push(`versione: ${meta.versionNo}`, `esportato: ${meta.exportedAt}`, '---');

  return righe.join('\n');
}

/**
 * Numera le figure in modo progressivo e coerente con il capitolo.
 * «Figura 11.3» è più utile di «Figura 3» in un'opera di trenta capitoli.
 */
export function numberFiguresInMarkdown(
  markdown: string,
  chapterNumber: number | null,
): { markdown: string; count: number } {
  let indice = 0;
  const prefisso = chapterNumber !== null ? `${chapterNumber}.` : '';

  const risultato = markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
    (_intero, alt: string, src: string, titolo: string | undefined) => {
      indice += 1;
      const etichetta = `Figura ${prefisso}${indice}`;
      // Se la didascalia già inizia con «Figura», non la si duplica.
      const testo = alt.trim().startsWith('Figura') ? alt.trim() : `${etichetta} — ${alt.trim()}`;
      return `![${testo}](${src}${titolo ?? ''})`;
    },
  );

  return { markdown: risultato, count: indice };
}

export function buildReferencesSection(citations: Citation[]): string {
  if (citations.length === 0) return '';

  const righe = ['', '## Riferimenti', ''];
  const ordinate = [...citations].sort((a, b) => {
    if (a.isOfficial !== b.isOfficial) return a.isOfficial ? -1 : 1;
    return (a.title ?? a.url).localeCompare(b.title ?? b.url, 'it');
  });

  ordinate.forEach((citation, index) => {
    const etichetta = citation.title || citation.publisher || citation.url;
    const nota = citation.isOfficial ? ' *(documentazione ufficiale)*' : '';
    righe.push(`${index + 1}. [${etichetta}](${citation.url})${nota}`);
  });

  return righe.join('\n');
}

export interface MarkdownExportResult {
  content: string;
  stats: { words: number; headings: number; codeBlocks: number; figures: number; citations: number };
}

export function exportMarkdown(
  contentMd: string,
  meta: ExportMeta,
  options: MarkdownExportOptions = {},
): MarkdownExportResult {
  const parsedMeta = exportMetaSchema.parse(meta);

  let corpo = contentMd.trimEnd();
  let figure = 0;

  if (options.numberFigures ?? true) {
    const numerato = numberFiguresInMarkdown(corpo, parsedMeta.chapterNumber);
    corpo = numerato.markdown;
    figure = numerato.count;
  }

  const citazioni = options.citations ?? [];
  const riferimenti = buildReferencesSection(citazioni);

  const parti: string[] = [];
  if (options.includeFrontMatter ?? true) parti.push(buildFrontMatter(parsedMeta), '');
  parti.push(corpo);
  if (riferimenti) parti.push(riferimenti);

  const content = `${parti.join('\n')}\n`;
  const analisi = analyzeMarkdown(corpo);

  return {
    content,
    stats: {
      words: analisi.wordCount,
      headings: analisi.headings.length,
      codeBlocks: analisi.codeBlocks.length,
      figures: figure,
      citations: citazioni.length,
    },
  };
}
