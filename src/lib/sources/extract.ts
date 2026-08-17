import 'server-only';

import { extractText, getDocumentProxy } from 'unpdf';
import {
  MAX_CHUNKS_PER_REFERENCE,
  MAX_LINK_CHARS,
  hasPdfSignature,
  splitIntoChunks,
  type ReferenceChunk,
} from './references';

/**
 * Estrazione del testo indicizzabile da un PDF o da una pagina web.
 *
 * Un PDF viene letto **pagina per pagina**: il numero di pagina viaggia con il
 * blocco fino alla proposta, così il revisore sa dove guardare invece di
 * ricevere un documento di duecento pagine e la parola «fidati».
 */

export interface ExtractionResult {
  chunks: ReferenceChunk[];
  pageCount: number | null;
  /** Titolo dichiarato dal documento, quando c'è: un suggerimento, non un obbligo. */
  detectedTitle: string | null;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export async function extractPdf(bytes: Uint8Array): Promise<ExtractionResult> {
  if (!hasPdfSignature(bytes)) {
    throw new Error('Il file non è un PDF: la firma iniziale non corrisponde.');
  }

  const warnings: string[] = [];
  const document = await getDocumentProxy(bytes);
  const { text: pages, totalPages } = await extractText(document, { mergePages: false });

  const metadata = await document.getMetadata().catch(() => null);
  const info = metadata?.info as { Title?: unknown } | undefined;
  const detectedTitle =
    typeof info?.Title === 'string' && info.Title.trim().length > 0 ? info.Title.trim() : null;

  const chunks: ReferenceChunk[] = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    if (chunks.length >= MAX_CHUNKS_PER_REFERENCE) {
      warnings.push(
        `Documento troncato a ${MAX_CHUNKS_PER_REFERENCE} blocchi: le pagine oltre la ` +
          `${pageIndex} non sono state indicizzate.`,
      );
      break;
    }

    const pageText = pages[pageIndex] ?? '';
    if (pageText.trim().length === 0) continue;

    chunks.push(
      ...splitIntoChunks(pageText, { page: pageIndex + 1, startIndex: chunks.length }),
    );
  }

  if (chunks.length === 0) {
    warnings.push(
      'Nessun testo estraibile: il PDF potrebbe essere una scansione. ' +
        'Serve un riconoscimento ottico prima di poterlo indicizzare.',
    );
  }

  return { chunks, pageCount: totalPages, detectedTitle, warnings };
}

// ---------------------------------------------------------------------------
// Pagine web
// ---------------------------------------------------------------------------

/** Elementi il cui contenuto non è testo della pagina. */
const STRIPPED = /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  laquo: '«', raquo: '»', egrave: 'è', eacute: 'é', agrave: 'à',
  igrave: 'ì', ograve: 'ò', ugrave: 'ù', hellip: '…', mdash: '—', ndash: '–',
};

function decodeEntities(html: string): string {
  return html
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

/**
 * Testo di una pagina, ricavato dall'HTML senza una libreria di parsing.
 *
 * Non è un browser e non pretende di esserlo: rimuove script e stili, tiene i
 * confini dei blocchi e restituisce il testo. Per indicizzare una pagina di
 * documentazione è quanto serve; per una applicazione a rendering interamente
 * client il risultato sarà povero, e il chiamante lo dichiara.
 */
export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]!).trim().slice(0, 300) : null;

  const text = decodeEntities(
    html
      .replace(STRIPPED, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, text: text.slice(0, MAX_LINK_CHARS) };
}

/** Timeout del recupero: una pagina che non risponde non deve bloccare l'inserimento. */
const FETCH_TIMEOUT_MS = 15_000;

export async function extractLink(url: string): Promise<ExtractionResult> {
  const warnings: string[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'ai-editorial-factory/reference-indexer' },
    });

    if (!response.ok) {
      return {
        chunks: [],
        pageCount: null,
        detectedTitle: null,
        warnings: [
          `La pagina ha risposto ${response.status}: il collegamento è registrato ma non indicizzato.`,
        ],
      };
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/pdf')) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const result = await extractPdf(bytes);
      return {
        ...result,
        warnings: [...result.warnings, 'L’indirizzo puntava a un PDF: indicizzato come documento.'],
      };
    }

    if (!contentType.includes('html') && !contentType.includes('text/')) {
      return {
        chunks: [],
        pageCount: null,
        detectedTitle: null,
        warnings: [`Tipo di contenuto non testuale (${contentType}): registrato senza indicizzazione.`],
      };
    }

    const html = await response.text();
    const { title, text } = htmlToText(html);

    if (text.length < 200) {
      warnings.push(
        'La pagina restituisce pochissimo testo: probabilmente si costruisce nel browser. ' +
          'Il collegamento resta valido, ma la ricerca automatica non potrà proporlo.',
      );
    }

    const chunks = splitIntoChunks(text).slice(0, MAX_CHUNKS_PER_REFERENCE);
    return { chunks, pageCount: null, detectedTitle: title, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      chunks: [],
      pageCount: null,
      detectedTitle: null,
      warnings: [
        `Pagina non raggiungibile (${message}): il collegamento è registrato ma non indicizzato.`,
      ],
    };
  } finally {
    clearTimeout(timer);
  }
}
