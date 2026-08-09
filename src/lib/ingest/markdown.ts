import { countWords } from './archive';

/**
 * Analisi di un documento Markdown.
 *
 * Il parsing è volutamente lessicale, non semantico: interessa individuare la
 * struttura editoriale (titoli, codice, figure, riferimenti, segnaposto), non
 * produrre un albero sintattico completo. I blocchi di codice vengono estratti
 * per primi, così il loro contenuto non inquina il conteggio delle parole né
 * viene scambiato per un titolo.
 */

export interface MarkdownHeading {
  level: number;
  text: string;
  line: number;
  slug: string;
}

export interface MarkdownCodeBlock {
  language: string | null;
  content: string;
  line: number;
  lineCount: number;
}

export interface MarkdownFigure {
  alt: string;
  src: string;
  line: number;
  /** Vero se il file indicato non è presente nell'archivio. */
  missing?: boolean;
}

export interface MarkdownPlaceholder {
  raw: string;
  description: string;
  line: number;
}

export interface MarkdownAnalysis {
  title: string | null;
  frontMatter: Record<string, string>;
  headings: MarkdownHeading[];
  codeBlocks: MarkdownCodeBlock[];
  figures: MarkdownFigure[];
  placeholders: MarkdownPlaceholder[];
  links: { url: string; text: string; line: number }[];
  callouts: { kind: string; line: number }[];
  wordCount: number;
  characterCount: number;
  lineCount: number;
}

const FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`]*)/;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Estrae il front matter YAML iniziale, se presente, come coppie chiave/valore. */
function parseFrontMatter(lines: string[]): { data: Record<string, string>; endLine: number } {
  if (lines[0]?.trim() !== '---') return { data: {}, endLine: 0 };

  const data: Record<string, string> = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === '---') return { data, endLine: i + 1 };

    const separator = line.indexOf(':');
    if (separator > 0) {
      const key = line.slice(0, separator).trim();
      const value = line
        .slice(separator + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (key) data[key] = value;
    }
  }
  return { data: {}, endLine: 0 };
}

export function analyzeMarkdown(source: string): MarkdownAnalysis {
  const lines = source.split(/\r?\n/);
  const { data: frontMatter, endLine } = parseFrontMatter(lines);

  const headings: MarkdownHeading[] = [];
  const codeBlocks: MarkdownCodeBlock[] = [];
  const figures: MarkdownFigure[] = [];
  const placeholders: MarkdownPlaceholder[] = [];
  const links: { url: string; text: string; line: number }[] = [];
  const callouts: { kind: string; line: number }[] = [];

  const proseLines: string[] = [];

  let inFence = false;
  let fenceMarker = '';
  let fenceLanguage: string | null = null;
  let fenceStart = 0;
  let fenceBuffer: string[] = [];

  for (let i = endLine; i < lines.length; i += 1) {
    const line = lines[i]!;
    const lineNumber = i + 1;

    const fenceMatch = FENCE.exec(line);

    if (inFence) {
      // Un blocco si chiude solo con un delimitatore dello stesso tipo e almeno
      // altrettanto lungo: così ``` dentro un blocco ```` non lo interrompe.
      if (
        fenceMatch &&
        fenceMatch[2]!.startsWith(fenceMarker[0]!) &&
        fenceMatch[2]!.length >= fenceMarker.length &&
        fenceMatch[3] === ''
      ) {
        codeBlocks.push({
          language: fenceLanguage,
          content: fenceBuffer.join('\n'),
          line: fenceStart,
          lineCount: fenceBuffer.length,
        });
        inFence = false;
        fenceBuffer = [];
        fenceLanguage = null;
      } else {
        fenceBuffer.push(line);
      }
      continue;
    }

    if (fenceMatch) {
      inFence = true;
      fenceMarker = fenceMatch[2]!;
      fenceLanguage = fenceMatch[3] ? fenceMatch[3].toLowerCase() : null;
      fenceStart = lineNumber;
      fenceBuffer = [];
      continue;
    }

    // Titoli ATX
    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (headingMatch) {
      const text = headingMatch[2]!.trim();
      headings.push({
        level: headingMatch[1]!.length,
        text,
        line: lineNumber,
        slug: slugify(text),
      });
      proseLines.push(text);
      continue;
    }

    // Callout in stile GitHub: > [!NOTE]
    const calloutMatch = /^\s*>\s*\[!([A-Za-z]+)\]/.exec(line);
    if (calloutMatch) callouts.push({ kind: calloutMatch[1]!.toUpperCase(), line: lineNumber });

    // Immagini
    for (const match of line.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      figures.push({ alt: match[1] ?? '', src: match[2] ?? '', line: lineNumber });
    }

    // Collegamenti (esclusi quelli già contati come immagini)
    for (const match of line.matchAll(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
      links.push({ text: match[1] ?? '', url: match[2] ?? '', line: lineNumber });
    }

    // Segnaposto per immagini non ancora prodotte, nelle forme più diffuse:
    //   [IMMAGINE: descrizione]   [FIGURA 3: ...]   <!-- TODO: illustrazione -->
    //
    // (?<!!) esclude il testo alternativo di un'immagine — in `![Figura](x.png)`
    // «Figura» è una didascalia, non un segnaposto — e (?!\() esclude il testo
    // di un collegamento.
    for (const match of line.matchAll(
      /(?<!!)\[(?:IMMAGINE|FIGURA|IMAGE|FIGURE|DIAGRAMMA|DIAGRAM|TODO)\b[^\]]*\](?!\()/gi,
    )) {
      const raw = match[0]!;
      placeholders.push({
        raw,
        description: raw.replace(/^\[|\]$/g, '').replace(/^[^:]*:\s*/, '').trim(),
        line: lineNumber,
      });
    }
    for (const match of line.matchAll(/<!--\s*(?:TODO|IMMAGINE|FIGURA)\b([^>]*)-->/gi)) {
      placeholders.push({
        raw: match[0]!,
        description: (match[1] ?? '').replace(/^[:\s]+/, '').trim(),
        line: lineNumber,
      });
    }

    proseLines.push(line);
  }

  // Un blocco lasciato aperto viene comunque registrato: il documento è
  // malformato, ma il contenuto non deve andare perduto.
  if (inFence && fenceBuffer.length > 0) {
    codeBlocks.push({
      language: fenceLanguage,
      content: fenceBuffer.join('\n'),
      line: fenceStart,
      lineCount: fenceBuffer.length,
    });
  }

  const prose = proseLines.join('\n');
  const titleFromFrontMatter = frontMatter.title ?? null;
  const firstH1 = headings.find((h) => h.level === 1);

  return {
    title: titleFromFrontMatter ?? firstH1?.text ?? null,
    frontMatter,
    headings,
    codeBlocks,
    figures,
    placeholders,
    links,
    callouts,
    wordCount: countWords(prose),
    characterCount: source.length,
    lineCount: lines.length,
  };
}
