import 'server-only';

import { extractText, extractTextItems, getDocumentProxy } from 'unpdf';
import { runLeakageGuard } from './gates';
import type { QualityIssue } from './types';

export interface PdfPageSnapshot {
  page: number;
  textHash: string;
  characters: number;
  textItems: number;
  width: number;
  height: number;
}

export interface PdfPreflightReport {
  passed: boolean;
  checksum: string;
  pageCount: number;
  pages: PdfPageSnapshot[];
  changedPages: number[];
  issues: QualityIssue[];
}

async function hash(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Verifica il PDF finale, non il solo manoscritto che lo ha prodotto. */
export async function inspectGeneratedPdf(
  bytes: Uint8Array,
  previousPages: Array<Pick<PdfPageSnapshot, 'page' | 'textHash'>> = [],
): Promise<PdfPreflightReport> {
  const pdf = await getDocumentProxy(bytes);
  const [{ text }, positioned] = await Promise.all([
    extractText(pdf, { mergePages: false }),
    extractTextItems(pdf),
  ]);
  const pageTexts = text as string[];
  const issues: QualityIssue[] = [];
  const pages: PdfPageSnapshot[] = [];

  for (let index = 0; index < pdf.numPages; index += 1) {
    const pageNumber = index + 1;
    const pageText = (pageTexts[index] ?? '').trim();
    const items = positioned.items[index] ?? [];
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const overflow = items.find((item) => item.x < -2 || item.x + item.width > viewport.width + 2);

    if (pageText.length < 20 && pdf.numPages > 1) {
      issues.push({ gate: 'layout_preflight', code: 'empty_page', severity: 'blocking', message: `Pagina ${pageNumber} vuota o quasi vuota.`, line: null, excerpt: pageText || null });
    }
    if (pageText.includes('\uFFFD')) {
      issues.push({ gate: 'layout_preflight', code: 'missing_glyph', severity: 'blocking', message: `Pagina ${pageNumber}: carattere non renderizzato.`, line: null, excerpt: pageText.slice(0, 160) });
    }
    if (overflow) {
      issues.push({ gate: 'layout_preflight', code: 'horizontal_overflow', severity: 'blocking', message: `Pagina ${pageNumber}: contenuto oltre il margine orizzontale.`, line: null, excerpt: overflow.str.slice(0, 160) });
    }

    pages.push({
      page: pageNumber,
      textHash: await hash(pageText.replace(/\s+/g, ' ')),
      characters: pageText.length,
      textItems: items.length,
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
    });
  }

  const leakage = runLeakageGuard(pageTexts.join('\n'));
  issues.push(...leakage.issues);
  const previousByPage = new Map(previousPages.map((page) => [page.page, page.textHash]));
  const changedPages = pages
    .filter((page) => previousByPage.has(page.page) && previousByPage.get(page.page) !== page.textHash)
    .map((page) => page.page);

  return {
    passed: !issues.some((issue) => issue.severity === 'blocking'),
    checksum: await hash(bytes),
    pageCount: pdf.numPages,
    pages,
    changedPages,
    issues,
  };
}
