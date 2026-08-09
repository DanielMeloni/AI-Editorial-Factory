import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { Root as HastRoot, Element } from 'hast';
import { visit } from 'unist-util-visit';
import type { Citation, ExportMeta } from './markdown';

/**
 * Esportazione in HTML semantico.
 *
 * Due vincoli guidano questo modulo:
 *
 *  1. **Sanitizzazione obbligatoria.** Il Markdown di partenza proviene da un
 *     archivio caricato: può contenere HTML arbitrario. Senza sanitizzazione
 *     un `<script>` nel manuale diventerebbe codice eseguito nel browser di
 *     chi legge l'anteprima.
 *  2. **Semantica reale.** `<article>`, `<header>`, `<section>`, `<figure>` con
 *     `<figcaption>`, `<footer>`: la struttura deve essere leggibile da uno
 *     screen reader e da un motore di ricerca, non solo dall'occhio.
 */

/**
 * Schema di sanitizzazione: parte da quello predefinito e aggiunge solo ciò che
 * serve a un manuale tecnico. `script`, `style`, `iframe` e i gestori di eventi
 * restano esclusi.
 */
const schema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'figure', 'figcaption', 'section', 'article', 'header', 'footer', 'aside',
  ],
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', /^hljs-./]],
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'id'],
  } as SanitizeSchema['attributes'],
};

/**
 * Trasforma un paragrafo che contiene solo un'immagine in `<figure>` con
 * `<figcaption>`: è la struttura corretta per una figura con didascalia, e
 * nessun generatore Markdown la produce da solo.
 */
function figuresPlugin() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'p' || !parent || index === undefined) return;

      const figli = node.children.filter(
        (child) => !(child.type === 'text' && child.value.trim() === ''),
      );
      const primo = figli[0];

      if (figli.length !== 1 || primo?.type !== 'element' || primo.tagName !== 'img') return;

      const alt = typeof primo.properties?.alt === 'string' ? primo.properties.alt : '';

      const figure: Element = {
        type: 'element',
        tagName: 'figure',
        properties: {},
        children: [
          primo,
          ...(alt
            ? [
                {
                  type: 'element' as const,
                  tagName: 'figcaption',
                  properties: {},
                  children: [{ type: 'text' as const, value: alt }],
                },
              ]
            : []),
        ],
      };

      (parent.children as unknown[])[index] = figure;
    });
  };
}

/** Assegna un id a ogni titolo, così i collegamenti interni funzionano. */
function headingIdsPlugin() {
  const usati = new Set<string>();

  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element) => {
      if (!/^h[1-6]$/.test(node.tagName)) return;
      if (node.properties?.id) return;

      const testo = estraiTesto(node);
      let slug =
        testo
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'sezione';

      let contatore = 1;
      const base = slug;
      while (usati.has(slug)) {
        contatore += 1;
        slug = `${base}-${contatore}`;
      }
      usati.add(slug);

      node.properties = { ...node.properties, id: slug };
    });
  };
}

function estraiTesto(node: Element): string {
  let out = '';
  visit(node, 'text', (text: { value: string }) => {
    out += text.value;
  });
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface HtmlExportOptions {
  citations?: Citation[];
  /** Documento completo con `<html>`, oppure solo il frammento `<article>`. */
  standalone?: boolean;
}

export interface HtmlExportResult {
  html: string;
  /** Frammento senza involucro, per l'anteprima nell'applicazione. */
  fragment: string;
}

export async function exportHtml(
  contentMd: string,
  meta: ExportMeta,
  options: HtmlExportOptions = {},
): Promise<HtmlExportResult> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSanitize, schema)
    .use(figuresPlugin)
    .use(headingIdsPlugin)
    .use(rehypeStringify)
    .process(contentMd);

  const corpo = String(file);

  const intestazione = [
    '<header>',
    meta.chapterLabel
      ? `<p class="eyebrow">${escapeHtml(meta.chapterLabel)}</p>`
      : '',
    `<h1>${escapeHtml(meta.title)}</h1>`,
    `<p class="meta"><span class="author">${escapeHtml(meta.author)}</span>`,
    meta.volume ? ` · <span class="volume">${escapeHtml(meta.volume)}</span>` : '',
    ` · <span class="version">versione ${meta.versionNo}</span></p>`,
    '</header>',
  ].join('');

  const riferimenti = (options.citations ?? []).length
    ? [
        '<footer><section class="references" aria-labelledby="riferimenti">',
        '<h2 id="riferimenti">Riferimenti</h2><ol>',
        ...(options.citations ?? []).map((citation) => {
          const etichetta = escapeHtml(citation.title || citation.publisher || citation.url);
          const nota = citation.isOfficial
            ? ' <em>(documentazione ufficiale)</em>'
            : '';
          return `<li><a href="${escapeHtml(citation.url)}" rel="noopener noreferrer">${etichetta}</a>${nota}</li>`;
        }),
        '</ol></section></footer>',
      ].join('')
    : '';

  const fragment = `<article lang="it">${intestazione}<section class="content">${corpo}</section>${riferimenti}</article>`;

  if (!(options.standalone ?? true)) {
    return { html: fragment, fragment };
  }

  const html = [
    '<!doctype html>',
    '<html lang="it">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(meta.title)} · ${escapeHtml(meta.projectTitle)}</title>`,
    `<meta name="author" content="${escapeHtml(meta.author)}">`,
    '<meta name="robots" content="noindex">',
    `<style>${BASE_CSS}</style>`,
    '</head>',
    `<body>${fragment}</body>`,
    '</html>',
  ].join('\n');

  return { html, fragment };
}

/** Foglio di stile minimo, pensato per la lettura prolungata e per la stampa. */
const BASE_CSS = `
:root { color-scheme: light dark; --testo:#16233d; --fondo:#fff; --tenue:#5a6b87; --bordo:#dfe4ec; --codice:#f4f6fa; }
@media (prefers-color-scheme: dark) { :root { --testo:#e8edf6; --fondo:#111a2e; --tenue:#9dabc4; --bordo:#2a3550; --codice:#18233c; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--fondo); color:var(--testo); font-family:ui-serif,Georgia,serif; line-height:1.7; }
article { max-width:44rem; margin:0 auto; padding:3rem 1.25rem 5rem; }
header { border-bottom:1px solid var(--bordo); padding-bottom:1.5rem; margin-bottom:2rem; }
.eyebrow { font-family:ui-sans-serif,system-ui,sans-serif; font-size:.8rem; letter-spacing:.08em; text-transform:uppercase; color:var(--tenue); margin:0 0 .4rem; }
h1 { font-size:2.1rem; line-height:1.2; margin:0 0 .6rem; }
h2 { font-size:1.5rem; margin-top:2.5rem; }
h3 { font-size:1.2rem; margin-top:2rem; }
.meta { font-family:ui-sans-serif,system-ui,sans-serif; font-size:.9rem; color:var(--tenue); margin:0; }
pre { background:var(--codice); border:1px solid var(--bordo); border-radius:.5rem; padding:1rem; overflow-x:auto; font-size:.85rem; line-height:1.5; }
code { font-family:ui-monospace,'SFMono-Regular',Consolas,monospace; font-size:.9em; }
:not(pre) > code { background:var(--codice); padding:.1em .35em; border-radius:.25rem; }
figure { margin:2rem 0; }
figure img { max-width:100%; height:auto; border-radius:.5rem; }
figcaption { font-family:ui-sans-serif,system-ui,sans-serif; font-size:.85rem; color:var(--tenue); margin-top:.5rem; }
blockquote { border-left:3px solid var(--bordo); margin:1.5rem 0; padding:.25rem 0 .25rem 1rem; color:var(--tenue); }
table { border-collapse:collapse; width:100%; font-size:.9rem; }
th, td { border:1px solid var(--bordo); padding:.5rem .7rem; text-align:left; }
th { background:var(--codice); }
.references { border-top:1px solid var(--bordo); margin-top:3rem; padding-top:1.5rem; font-size:.9rem; }
@media print { body { background:#fff; color:#000; } pre, th { background:#f6f6f6; } article { max-width:none; padding:0; } }
`.trim();
