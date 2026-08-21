import { strToU8, zipSync } from 'fflate';
import type { Citation, ExportMeta } from './markdown';
import { exportHtml } from './html';

/** EPUB 3 minimale e valido, costruito dal medesimo HTML sanificato dell'export web. */
export async function exportEpub(
  contentMd: string,
  meta: ExportMeta,
  options: { citations?: Citation[] } = {},
): Promise<Uint8Array> {
  const { fragment } = await exportHtml(contentMd, meta, {
    citations: options.citations,
    standalone: false,
  });
  const identificativo = `urn:uuid:${crypto.randomUUID()}`;
  const titolo = escapeXml(meta.title);
  const autore = escapeXml(meta.author);
  const contenuto = toXhtml(fragment);

  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
        '</container>',
    ),
    'OEBPS/content.opf': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="it">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${identificativo}</dc:identifier>
    <dc:title>${titolo}</dc:title><dc:creator>${autore}</dc:creator><dc:language>it</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`,
    ),
    'OEBPS/nav.xhtml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="it"><head><title>Indice</title></head>
<body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>Indice</h1><ol><li><a href="chapter.xhtml">${titolo}</a></li></ol></nav></body></html>`,
    ),
    'OEBPS/chapter.xhtml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="it"><head><title>${titolo}</title></head><body>${contenuto}</body></html>`,
    ),
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toXhtml(value: string): string {
  return value
    .replace(/<br>/g, '<br />')
    .replace(/<hr>/g, '<hr />')
    .replace(/<img([^>]*?)(?<!\/)\s*>/g, '<img$1 />');
}
