import 'server-only';

import * as React from 'react';
import { Document, Image, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, RootContent, PhrasingContent } from 'mdast';
import type { Citation, ExportMeta } from './markdown';

/**
 * Generazione del PDF.
 *
 * Scelta di fondo: `@react-pdf/renderer` è JavaScript puro. L'alternativa
 * consueta — Puppeteer con Chromium — richiede un binario da oltre cento
 * megabyte nel bundle serverless, che eccede i limiti di una Vercel Function e
 * va installato a ogni avvio a freddo. Qui non c'è alcun binario: il PDF si
 * genera ovunque giri Node.
 *
 * Il documento è costruito dall'albero Markdown, non dall'HTML: così la
 * struttura tipografica è controllata direttamente e non dipende da un motore
 * di rendering.
 */

const colori = {
  testo: '#16233d',
  tenue: '#5a6b87',
  bordo: '#dfe4ec',
  codiceFondo: '#f4f6fa',
  accento: '#3556a8',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 64,
    paddingHorizontal: 64,
    fontSize: 10.5,
    lineHeight: 1.6,
    color: colori.testo,
    fontFamily: 'Helvetica',
  },
  eyebrow: {
    fontSize: 8,
    color: colori.tenue,
    letterSpacing: 1,
    marginBottom: 6,
    fontFamily: 'Helvetica',
  },
  titolo: { fontSize: 22, fontFamily: 'Helvetica-Bold', marginBottom: 8, lineHeight: 1.25 },
  metaTesta: { fontSize: 9, color: colori.tenue, marginBottom: 20, fontFamily: 'Helvetica' },
  h1: { fontSize: 17, fontFamily: 'Helvetica-Bold', marginTop: 20, marginBottom: 8 },
  h2: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 18, marginBottom: 6 },
  h3: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 5 },
  h4: { fontSize: 11, fontFamily: 'Helvetica-BoldOblique', marginTop: 12, marginBottom: 4 },
  paragrafo: { marginBottom: 9, textAlign: 'justify' },
  codiceBlocco: {
    backgroundColor: '#eef2f7',
    borderWidth: 1,
    borderColor: '#b8c2d1',
    borderLeftWidth: 4,
    borderLeftColor: '#475569',
    borderRadius: 5,
    padding: 10,
    marginVertical: 8,
  },
  codiceRiga: { fontFamily: 'Courier', fontSize: 8.5, lineHeight: 1.45 },
  codiceLingua: {
    fontFamily: 'Helvetica',
    fontSize: 7,
    color: colori.tenue,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  citazione: {
    borderLeftWidth: 4,
    borderLeftColor: '#64748b',
    backgroundColor: '#f8fafc',
    padding: 10,
    marginBottom: 10,
    color: colori.testo,
  },
  vocElenco: { flexDirection: 'row', marginBottom: 4 },
  segno: { width: 16, color: colori.tenue },
  vocTesto: { flex: 1 },
  figura: {
    borderWidth: 0.5,
    borderColor: colori.bordo,
    borderStyle: 'dashed',
    borderRadius: 3,
    padding: 14,
    marginBottom: 10,
    alignItems: 'center',
  },
  didascalia: {
    fontSize: 8.5,
    color: colori.tenue,
    fontFamily: 'Helvetica',
    marginTop: 5,
    textAlign: 'center',
  },
  separatore: { borderBottomWidth: 0.5, borderBottomColor: colori.bordo, marginVertical: 14 },
  tabellaRiga: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: colori.bordo },
  tabellaCella: { flex: 1, padding: 5, fontSize: 9 },
  tabellaIntestazione: { backgroundColor: colori.codiceFondo, fontFamily: 'Helvetica-Bold' },
  riferimenti: { marginTop: 24, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: colori.bordo },
  titoloRiferimenti: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  riferimento: { fontSize: 8.5, color: colori.tenue, marginBottom: 3 },
  piede: {
    position: 'absolute',
    bottom: 32,
    left: 64,
    right: 64,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: colori.tenue,
    fontFamily: 'Helvetica',
  },
});

/** Converte il testo in linea in nodi Text, conservando enfasi e codice. */
function renderInline(nodes: PhrasingContent[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (node.type) {
      case 'text':
        return <Text key={key}>{testoInterrompibile(node.value)}</Text>;
      case 'strong':
        return (
          <Text key={key} style={{ fontFamily: 'Helvetica-Bold' }}>
            {renderInline(node.children, key)}
          </Text>
        );
      case 'emphasis':
        return (
          <Text key={key} style={{ fontFamily: 'Helvetica-Oblique' }}>
            {renderInline(node.children, key)}
          </Text>
        );
      case 'inlineCode':
        return (
          <Text key={key} style={{ fontFamily: 'Courier', fontSize: 9 }}>
            {testoInterrompibile(node.value)}
          </Text>
        );
      case 'link':
        // L'URL viene mostrato accanto al testo: su carta un collegamento
        // cliccabile non serve a nulla se non se ne legge la destinazione.
        return (
          <Text key={key}>
            <Text style={{ color: colori.accento }}>{renderInline(node.children, key)}</Text>
            <Text style={{ fontSize: 8, color: colori.tenue }}>
              {' ('}
              {testoInterrompibile(node.url)}
              {')'}
            </Text>
          </Text>
        );
      case 'delete':
        return (
          <Text key={key} style={{ textDecoration: 'line-through' }}>
            {renderInline(node.children, key)}
          </Text>
        );
      case 'break':
        return <Text key={key}>{'\n'}</Text>;
      case 'image':
        return (
          <Text key={key} style={{ fontSize: 8, color: colori.tenue }}>
            [{node.alt || 'figura'}]
          </Text>
        );
      default:
        return null;
    }
  });
}

/** Impedisce a URL, hash e identificatori molto lunghi di mandare Yoga fuori scala. */
function testoInterrompibile(value: string): string {
  return value.replace(/\S{72,}/g, (token) => token.match(/.{1,48}/g)?.join('\u200b') ?? token);
}

const STILI_TITOLO = [styles.h1, styles.h1, styles.h2, styles.h3, styles.h4, styles.h4, styles.h4];

const CALLOUT = {
  attenzione: { borderLeftColor: '#dc2626', backgroundColor: '#fef2f2' },
  importante: { borderLeftColor: '#0284c7', backgroundColor: '#f0f9ff' },
  nota: { borderLeftColor: '#16a34a', backgroundColor: '#f0fdf4' },
  obiettivi: { borderLeftColor: '#94a3b8', backgroundColor: '#f1f5f9' },
  default: { borderLeftColor: '#64748b', backgroundColor: '#f8fafc' },
} as const;

function stileCallout(node: Extract<RootContent, { type: 'blockquote' }>) {
  const testo = plainBlockText(node).toLowerCase();
  if (/\b(att(?:enzione)?|warning)\b/.test(testo)) return CALLOUT.attenzione;
  if (/\b(importante|important)\b/.test(testo)) return CALLOUT.importante;
  if (/\b(nota|note)\b/.test(testo)) return CALLOUT.nota;
  if (/\b(obiettiv[oi]|objectives?)\b/.test(testo)) return CALLOUT.obiettivi;
  return CALLOUT.default;
}

function plainBlockText(node: RootContent): string {
  if ('children' in node && Array.isArray(node.children)) {
    return node.children
      .map((child) =>
        'type' in child && (child.type === 'text' || child.type === 'inlineCode')
          ? child.value
          : plainBlockText(child as RootContent),
      )
      .join(' ');
  }
  return '';
}

function parsePdfMarkdown(contentMd: string, title: string): Root {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(contentMd) as Root;
  const first = tree.children[0];
  if (first?.type === 'heading' && first.depth === 1) {
    const heading = plainInline(first.children);
    if (titoliEquivalenti(heading, title)) tree.children.shift();
  }
  return tree;
}

function titoliEquivalenti(a: string, b: string): boolean {
  const normalizza = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/^capitolo\s+[\w.-]+\s*[-–—:]?\s*/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return normalizza(a) === normalizza(b);
}

function renderBlock(node: RootContent, key: string): React.ReactNode {
  switch (node.type) {
    case 'heading':
      return (
        <Text key={key} style={STILI_TITOLO[node.depth]} minPresenceAhead={40}>
          {renderInline(node.children, key)}
        </Text>
      );

    case 'paragraph': {
      // Un paragrafo con la sola immagine diventa una figura con didascalia.
      const soloImmagine =
        node.children.length === 1 && node.children[0]?.type === 'image' ? node.children[0] : null;

      if (soloImmagine && soloImmagine.type === 'image') {
        return (
          <View key={key} style={styles.figura} wrap={false}>
            <Text style={{ fontSize: 8, color: colori.tenue }}>
              [ {soloImmagine.alt || 'figura'} ]
            </Text>
            {soloImmagine.alt ? <Text style={styles.didascalia}>{soloImmagine.alt}</Text> : null}
          </View>
        );
      }

      return (
        <Text key={key} style={styles.paragrafo}>
          {renderInline(node.children, key)}
        </Text>
      );
    }

    case 'code':
      return (
        <View key={key} style={styles.codiceBlocco}>
          <Text style={styles.codiceLingua}>
            CODICE{node.lang ? ` · ${node.lang.toUpperCase()}` : ''}
          </Text>
          {node.value.split('\n').map((riga, index) => (
            <Text key={`${key}-r${index}`} style={styles.codiceRiga}>
              {testoInterrompibile(riga || ' ')}
            </Text>
          ))}
        </View>
      );

    case 'blockquote':
      return (
        <View key={key} style={{ ...styles.citazione, ...stileCallout(node) }}>
          {node.children.map((child, index) => renderBlock(child, `${key}-${index}`))}
        </View>
      );

    case 'list':
      return (
        <View key={key} style={{ marginBottom: 9 }}>
          {node.children.map((item, index) => (
            <View key={`${key}-i${index}`} style={styles.vocElenco}>
              <Text style={styles.segno}>
                {node.ordered ? `${(node.start ?? 1) + index}.` : '•'}
              </Text>
              <View style={styles.vocTesto}>
                {item.children.map((child, childIndex) =>
                  renderBlock(child, `${key}-i${index}-${childIndex}`),
                )}
              </View>
            </View>
          ))}
        </View>
      );

    case 'table':
      return (
        <View key={key} style={{ marginBottom: 10 }}>
          {node.children.map((riga, rigaIndex) => (
            <View
              key={`${key}-r${rigaIndex}`}
              style={
                rigaIndex === 0
                  ? [styles.tabellaRiga, styles.tabellaIntestazione]
                  : styles.tabellaRiga
              }
            >
              {riga.children.map((cella, cellaIndex) => (
                <Text key={`${key}-r${rigaIndex}-c${cellaIndex}`} style={styles.tabellaCella}>
                  {renderInline(cella.children, `${key}-${rigaIndex}-${cellaIndex}`)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );

    case 'thematicBreak':
      return <View key={key} style={styles.separatore} />;

    default:
      return null;
  }
}

export interface PdfExportOptions {
  citations?: Citation[];
}

export async function exportPdf(
  contentMd: string,
  meta: ExportMeta,
  options: PdfExportOptions = {},
): Promise<Uint8Array> {
  const albero = parsePdfMarkdown(contentMd, meta.title);

  const citazioni = options.citations ?? [];

  const documento = (
    <Document
      title={`${meta.title} — ${meta.projectTitle}`}
      author={meta.author}
      subject={meta.chapterLabel ?? undefined}
      creator="AI Editorial Factory"
      producer="AI Editorial Factory"
      language="it"
    >
      <Page size="A4" style={styles.page}>
        {meta.chapterLabel ? (
          <Text style={styles.eyebrow}>{meta.chapterLabel.toUpperCase()}</Text>
        ) : null}
        <Text style={styles.titolo}>{meta.title}</Text>
        <Text style={styles.metaTesta}>
          {[meta.author, meta.projectTitle, meta.volume, `versione ${meta.versionNo}`]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>

        {albero.children.map((node, index) => renderBlock(node, `b${index}`))}

        {citazioni.length > 0 ? (
          <View style={styles.riferimenti}>
            <Text style={styles.titoloRiferimenti}>Riferimenti</Text>
            {citazioni.map((citation, index) => (
              <Text key={`ref-${index}`} style={styles.riferimento}>
                {index + 1}. {citation.title || citation.publisher || citation.url} — {citation.url}
                {citation.isOfficial ? ' (documentazione ufficiale)' : ''}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.piede} fixed>
          <Text>{meta.projectTitle}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );

  const buffer = await renderToBuffer(documento);
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// Anteprima del volume
// ---------------------------------------------------------------------------

export interface VolumeChapterInput {
  label: string;
  title: string;
  contentMd: string;
  versionNo: number;
  /** Falso per i capitoli scritti ma non ancora approvati. */
  approved: boolean;
  figures: VolumeFigure[];
}

/**
 * Una figura del capitolo.
 *
 * `dataUrl` c'è per le immagini vere — illustrazioni generate o caricate — e
 * manca per i diagrammi, che nel progetto esistono come sorgente Mermaid e non
 * come pixel. Disegnarli qui richiederebbe un browser, che è esattamente la
 * dipendenza che questo generatore di PDF evita. Per quelli si stampa il
 * sorgente, dichiarando che la resa si vede nell'applicazione: meglio un
 * riquadro onesto di una figura mancante e silenziosa.
 */
export interface VolumeFigure {
  title: string | null;
  caption: string | null;
  altText: string | null;
  dataUrl: string | null;
  mermaidSource: string | null;
  /** Motivo per cui un asset non può essere incorporato nel PDF. */
  unavailableReason?: string | null;
}

export interface VolumeMeta {
  projectTitle: string;
  subtitle: string | null;
  author: string;
  volume: string | null;
  /** Passata da fuori: un documento deve poter essere rigenerato identico. */
  generatedAt: string;
  /** Capitoli senza alcun testo, quindi assenti. */
  pending: number;
  /** Capitoli presenti ma non ancora approvati. */
  drafts: number;
}

/**
 * Il volume intero, come si presenterà stampato.
 *
 * Ogni capitolo apre una pagina nuova, come in tipografia: l'anteprima serve a
 * giudicare il libro, e un libro in cui i capitoli si accavallano non è il
 * libro che si stamperà.
 *
 * Il frontespizio dichiara che si tratta di un'anteprima e quanti capitoli
 * mancano ancora. Un PDF che sembra finito e non lo è è peggio di nessun PDF.
 */
/** Le figure del capitolo, in coda al testo. */
function renderFigure(figure: VolumeFigure, key: string): React.ReactNode {
  return (
    <View key={key} style={{ marginBottom: 12 }}>
      {figure.dataUrl ? (
        // Dimensioni imposte: non propagare nel layout eventuali misure DPI
        // assurde contenute nei metadati del file.
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image
          src={figure.dataUrl}
          style={{ width: '100%', maxHeight: 420, marginBottom: 4, objectFit: 'contain' }}
        />
      ) : (
        <View style={styles.figura}>
          <Text style={{ fontSize: 8, color: colori.tenue, marginBottom: 4 }}>
            {figure.unavailableReason ?? 'DIAGRAMMA — la resa grafica si vede nell’applicazione'}
          </Text>
          {figure.mermaidSource ? (
            <Text style={styles.codiceRiga}>
              {testoInterrompibile(figure.mermaidSource.trim())}
            </Text>
          ) : null}
        </View>
      )}

      {figure.title || figure.caption ? (
        <Text style={{ fontSize: 8.5, color: colori.tenue }}>
          {[figure.title, figure.caption].filter(Boolean).join(' — ')}
        </Text>
      ) : null}

      {/* Il testo alternativo è parte del contenuto, non un attributo tecnico:
          chi rilegge deve poterlo controllare come controlla una didascalia. */}
      {figure.altText ? (
        <Text style={{ fontSize: 7.5, color: colori.tenue }}>Alt: {figure.altText}</Text>
      ) : null}
    </View>
  );
}

export async function exportVolumePdf(
  chapters: VolumeChapterInput[],
  meta: VolumeMeta,
): Promise<Uint8Array> {
  const documento = (
    <Document
      title={`${meta.projectTitle}${meta.volume ? ` — ${meta.volume}` : ''}`}
      author={meta.author}
      creator="AI Editorial Factory"
      producer="AI Editorial Factory"
      language="it"
    >
      {/* Frontespizio */}
      <Page size="A4" style={styles.page}>
        <View style={{ marginTop: 140 }}>
          <Text style={styles.eyebrow}>ANTEPRIMA DI LAVORAZIONE</Text>
          <Text style={{ ...styles.titolo, fontSize: 30 }}>{meta.projectTitle}</Text>
          {meta.subtitle ? (
            <Text style={{ fontSize: 14, color: colori.tenue, marginBottom: 14 }}>
              {meta.subtitle}
            </Text>
          ) : null}
          <Text style={styles.metaTesta}>
            {[meta.author, meta.volume].filter(Boolean).join('  ·  ')}
          </Text>
          <Text style={{ fontSize: 9, color: colori.tenue, fontFamily: 'Helvetica' }}>
            Composta il {meta.generatedAt} · {chapters.length}{' '}
            {chapters.length === 1 ? 'capitolo' : 'capitoli'}
            {meta.drafts > 0
              ? ` · ${meta.drafts} in bozza, marcati come tali`
              : ' · tutti approvati'}
            {meta.pending > 0 ? ` · ${meta.pending} non ancora scritti` : ''}
          </Text>
        </View>
      </Page>

      {/* Indice */}
      {chapters.length > 0 ? (
        <Page size="A4" style={styles.page}>
          <Text style={styles.titolo}>Indice</Text>
          {chapters.map((capitolo, indice) => (
            <View key={`toc-${indice}`} style={styles.vocElenco}>
              <Text style={{ ...styles.segno, width: 90, fontFamily: 'Helvetica', fontSize: 9 }}>
                {capitolo.label}
              </Text>
              <Text style={styles.vocTesto}>
                {capitolo.title}
                {capitolo.approved ? '' : '  (bozza non approvata)'}
              </Text>
            </View>
          ))}
          <View style={styles.piede} fixed>
            <Text>{meta.projectTitle}</Text>
            <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
          </View>
        </Page>
      ) : null}

      {/* Capitoli */}
      {chapters.map((capitolo, indice) => {
        const albero = parsePdfMarkdown(capitolo.contentMd, capitolo.title);

        return (
          <Page key={`cap-${indice}`} size="A4" style={styles.page}>
            {capitolo.label ? (
              <Text style={styles.eyebrow}>
                {capitolo.label.toUpperCase()}
                {capitolo.approved ? '' : '  ·  BOZZA NON APPROVATA'}
              </Text>
            ) : null}
            <Text style={styles.titolo}>{capitolo.title}</Text>
            <Text style={styles.metaTesta}>
              versione {capitolo.versionNo}
              {capitolo.approved ? '' : '  ·  in attesa di approvazione'}
            </Text>

            {albero.children.map((node, i) => renderBlock(node, `c${indice}-b${i}`))}

            {capitolo.figures.length > 0 ? (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.h2}>Figure</Text>
                {capitolo.figures.map((figura, i) => renderFigure(figura, `c${indice}-f${i}`))}
              </View>
            ) : null}

            <View style={styles.piede} fixed>
              <Text>{meta.projectTitle}</Text>
              <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
            </View>
          </Page>
        );
      })}

      {/* Un volume senza capitoli convalidati lo dice, invece di essere vuoto */}
      {chapters.length === 0 ? (
        <Page size="A4" style={styles.page}>
          <Text style={styles.titolo}>Nessun capitolo scritto</Text>
          <Text style={styles.paragrafo}>
            L’anteprima raccoglie tutto ciò che è stato scritto, approvato o no. Avvia l’audit su un
            capitolo e comparirà qui.
          </Text>
        </Page>
      ) : null}
    </Document>
  );

  const buffer = await renderToBuffer(documento);
  return new Uint8Array(buffer);
}

/**
 * Renderer di ultima istanza, intenzionalmente privo di Yoga complesso.
 * Conserva l'intero testo dividendolo in pagine di dimensione prevedibile.
 */
export async function exportVolumePdfLineare(
  chapters: VolumeChapterInput[],
  meta: VolumeMeta,
): Promise<Uint8Array> {
  const documento = (
    <Document
      title={pulisciTestoPdf(meta.projectTitle)}
      author={pulisciTestoPdf(meta.author)}
      creator="AI Editorial Factory"
    >
      <Page size="A4" style={{ padding: 56, fontFamily: 'Helvetica', fontSize: 10 }}>
        <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 26, marginTop: 120, marginBottom: 14 }}>
          {pulisciTestoPdf(meta.projectTitle)}
        </Text>
        {meta.subtitle ? (
          <Text style={{ fontSize: 14 }}>{pulisciTestoPdf(meta.subtitle)}</Text>
        ) : null}
        <Text style={{ marginTop: 18 }}>{pulisciTestoPdf(meta.author)}</Text>
        <Text style={{ marginTop: 28, fontSize: 9 }}>
          Anteprima lineare di sicurezza · {chapters.length} capitoli
        </Text>
      </Page>

      {chapters.map((chapter, indice) => {
        const tree = parsePdfMarkdown(chapter.contentMd, chapter.title);
        return (
        <Page
          key={`safe-${indice}`}
          size="A4"
          style={{ padding: 48, fontFamily: 'Helvetica', fontSize: 9.5, lineHeight: 1.5 }}
        >
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 15, marginBottom: 12 }}>
            {pulisciTestoPdf(`${chapter.label} — ${chapter.title}`)}
          </Text>
          {tree.children.map((node, nodeIndex) =>
            renderBlockLineare(node, `safe-${indice}-${nodeIndex}`),
          )}
        </Page>
        );
      })}
    </Document>
  );

  const buffer = await renderToBuffer(documento);
  return new Uint8Array(buffer);
}

/**
 * Fallback tipografico a bassa complessità. Non usa tabelle, immagini o
 * contenitori annidati che possono mandare Yoga fuori scala, ma interpreta
 * comunque il Markdown: il lettore non deve mai vedere #, ** o > grezzi.
 */
function renderBlockLineare(node: RootContent, key: string): React.ReactNode {
  switch (node.type) {
    case 'heading':
      return (
        <Text
          key={key}
          style={{
            fontFamily: 'Helvetica-Bold',
            fontSize: node.depth === 1 ? 15 : node.depth === 2 ? 12.5 : 11,
            marginTop: node.depth === 1 ? 12 : 9,
            marginBottom: 5,
          }}
        >
          {renderInline(node.children, key)}
        </Text>
      );
    case 'paragraph':
      return (
        <Text key={key} style={{ marginBottom: 7, textAlign: 'justify' }}>
          {renderInline(node.children, key)}
        </Text>
      );
    case 'blockquote':
      return (
        <View
          key={key}
          style={{
            borderLeftWidth: 4,
            padding: 9,
            marginBottom: 9,
            borderRadius: 4,
            ...stileCallout(node),
          }}
        >
          {node.children.map((child, index) => renderBlockLineare(child, `${key}-${index}`))}
        </View>
      );
    case 'list':
      return (
        <View key={key} style={{ marginBottom: 7 }}>
          {node.children.map((item, index) => (
            <View key={`${key}-${index}`} style={{ flexDirection: 'row', marginBottom: 2 }}>
              <Text style={{ width: 18 }}>{node.ordered ? `${(node.start ?? 1) + index}.` : '•'}</Text>
              <View style={{ flex: 1 }}>
                {item.children.map((child, childIndex) =>
                  renderBlockLineare(child, `${key}-${index}-${childIndex}`),
                )}
              </View>
            </View>
          ))}
        </View>
      );
    case 'code':
      return (
        <View
          key={key}
          style={{
            backgroundColor: '#eef2f7',
            borderWidth: 1,
            borderColor: '#b8c2d1',
            borderLeftWidth: 4,
            borderLeftColor: '#475569',
            borderRadius: 5,
            padding: 10,
            marginVertical: 8,
          }}
        >
          {node.lang ? (
            <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 7, color: '#475569', marginBottom: 5 }}>
              CODICE · {node.lang.toUpperCase()}
            </Text>
          ) : null}
          <Text style={{ fontFamily: 'Courier', fontSize: 8 }}>{pulisciTestoPdf(node.value)}</Text>
        </View>
      );
    case 'table':
      return (
        <View key={key} style={{ marginBottom: 8 }}>
          {node.children.map((row, rowIndex) => (
            <Text key={`${key}-${rowIndex}`} style={{ fontFamily: rowIndex === 0 ? 'Helvetica-Bold' : 'Helvetica', marginBottom: 2 }}>
              {row.children.map((cell) => plainInline(cell.children)).join('  ·  ')}
            </Text>
          ))}
        </View>
      );
    case 'thematicBreak':
      return <View key={key} style={{ borderBottomWidth: 0.5, borderBottomColor: colori.bordo, marginVertical: 8 }} />;
    default:
      return null;
  }
}

function plainInline(nodes: PhrasingContent[]): string {
  return nodes
    .map((node) => {
      if ('children' in node && Array.isArray(node.children)) return plainInline(node.children as PhrasingContent[]);
      if (node.type === 'text' || node.type === 'inlineCode') return node.value;
      if (node.type === 'image') return node.alt ?? '';
      if (node.type === 'break') return '\n';
      return '';
    })
    .join('');
}

function pulisciTestoPdf(value: string): string {
  return testoInterrompibile(value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''));
}

