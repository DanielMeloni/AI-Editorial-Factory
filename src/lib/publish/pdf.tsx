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
  accento: '#0797a7',
  carta: '#fffdf8',
  acqua: '#e8f5f2',
  arancio: '#f36f3d',
  arancioChiaro: '#fff3eb',
  codiceScuro: '#073047',
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
    backgroundColor: colori.carta,
  },
  eyebrow: {
    fontSize: 8,
    color: colori.tenue,
    letterSpacing: 1,
    marginBottom: 6,
    fontFamily: 'Helvetica',
  },
  titolo: { fontSize: 24, fontFamily: 'Helvetica-Bold', marginBottom: 8, lineHeight: 1.18 },
  metaTesta: { fontSize: 9, color: colori.tenue, marginBottom: 20, fontFamily: 'Helvetica' },
  h1: { fontSize: 17, fontFamily: 'Helvetica-Bold', marginTop: 20, marginBottom: 8 },
  h2: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginTop: 18, marginBottom: 6 },
  h3: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 5 },
  h4: { fontSize: 11, fontFamily: 'Helvetica-BoldOblique', marginTop: 12, marginBottom: 4 },
  paragrafo: { marginBottom: 9, textAlign: 'justify' },
  codiceBlocco: {
    backgroundColor: colori.codiceScuro,
    borderWidth: 0,
    borderRadius: 5,
    padding: 10,
    marginVertical: 8,
  },
  codiceRiga: { fontFamily: 'Courier', fontSize: 8.5, lineHeight: 1.45, color: '#f5fbff' },
  codiceLingua: {
    fontFamily: 'Helvetica',
    fontSize: 7,
    color: '#9fdde5',
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
    bottom: 20,
    left: 64,
    right: 64,
    height: 28,
    borderTopWidth: 0.7,
    borderTopColor: colori.bordo,
    paddingTop: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 8,
    color: colori.testo,
    fontFamily: 'Helvetica',
  },
  numeroPagina: {
    position: 'absolute',
    bottom: 27,
    right: 64,
    width: 48,
    textAlign: 'right',
    fontSize: 8.5,
    color: colori.testo,
    fontFamily: 'Helvetica-Bold',
  },
  testatina: {
    position: 'absolute', top: 26, left: 64, right: 64,
    flexDirection: 'row', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: colori.accento,
    paddingBottom: 7, fontSize: 7.5, color: colori.testo, fontFamily: 'Helvetica-Bold',
  },
  aperturaNumero: {
    position: 'absolute', right: 48, top: 30,
    fontSize: 112, color: '#e8efec', fontFamily: 'Helvetica-Bold',
  },
  aperturaCorpo: { marginTop: 72 },
  aperturaLabel: { fontSize: 10, color: colori.accento, fontFamily: 'Helvetica-Bold', marginBottom: 18 },
  aperturaTitolo: { width: '82%', fontSize: 34, lineHeight: 1.08, fontFamily: 'Helvetica-Bold', marginBottom: 12 },
  aperturaSottotitolo: { width: '78%', fontSize: 12, color: colori.tenue, marginBottom: 22 },
  schemaApertura: { height: 180, marginVertical: 8, justifyContent: 'center', alignItems: 'center' },
  schemaRiga: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  schemaNodo: { width: 62, height: 50, borderWidth: 1, borderColor: colori.accento, backgroundColor: '#f3fbfa', justifyContent: 'center', alignItems: 'center' },
  schemaCentro: { width: 70, height: 58, borderRadius: 8, backgroundColor: colori.accento, justifyContent: 'center', alignItems: 'center' },
  schemaLinea: { width: 42, borderTopWidth: 1.5, borderTopColor: colori.accento },
  obiettiviTitolo: { borderBottomWidth: 1, borderBottomColor: colori.accento, paddingBottom: 6, marginBottom: 10, fontSize: 8, color: colori.accento, fontFamily: 'Helvetica-Bold', letterSpacing: 0.7 },
  obiettiviRiga: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  obiettivo: { width: '31%', flexDirection: 'row', fontSize: 8, lineHeight: 1.35, marginBottom: 10 },
  iconaNumero: { width: 18, height: 18, borderRadius: 9, marginRight: 7, backgroundColor: colori.accento, color: '#ffffff', fontSize: 7, fontFamily: 'Helvetica-Bold', textAlign: 'center', paddingTop: 5 },
  contenutoRiga: { flexDirection: 'row', alignItems: 'flex-start' },
  contenutoPrincipale: { width: '67%', paddingRight: 18 },
  contenutoLaterale: { width: '33%', paddingLeft: 8 },
  calloutLaterale: { borderRadius: 7, backgroundColor: colori.acqua, padding: 12, marginBottom: 14 },
  calloutAttenzione: { borderWidth: 1, borderColor: '#f5a079', backgroundColor: colori.arancioChiaro },
  calloutTitolo: { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
  calloutIcona: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: colori.accento, marginRight: 6, justifyContent: 'center', alignItems: 'center' },
  calloutEtichetta: { fontSize: 7.5, color: colori.accento, fontFamily: 'Helvetica-Bold', letterSpacing: 0.6 },
  checklist: { marginTop: 8, borderTopWidth: 1, borderTopColor: colori.accento, paddingTop: 8 },
  checklistRiga: { flexDirection: 'row', marginBottom: 7, fontSize: 7.5, lineHeight: 1.3 },
  check: { width: 20, color: colori.accento, fontFamily: 'Helvetica-Bold', fontSize: 6.5 },
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
  partId?: string | null;
  partNumber?: number | null;
  partTitle?: string | null;
  citations?: Citation[];
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
  /** Titolo della configurazione del volume, usato nel piè di pagina. */
  volumeTitle?: string | null;
  subtitle: string | null;
  author: string;
  volume: string | null;
  /** Logo originale dello strumento incorporato nel PDF. */
  toolLogoDataUrl?: string | null;
  frontCoverDataUrl?: string | null;
  backCoverDataUrl?: string | null;
  /** Colore caratteristico ricavato dallo strumento/logo. */
  accentColor?: string | null;
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
        figure.mermaidSource
          ? <DiagrammaMermaid source={figure.mermaidSource} />
          : <View style={styles.figura}>
              <Text style={{ fontSize: 8, color: colori.tenue }}>
                {figure.unavailableReason ?? 'Figura non disponibile'}
              </Text>
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

export interface VolumePdfOptions {
  /** Estratto editoriale: niente copertine, indice o apertura della parte. */
  chapterExtract?: boolean;
}

export async function exportVolumePdf(
  chapters: VolumeChapterInput[],
  meta: VolumeMeta,
  options: VolumePdfOptions = {},
): Promise<Uint8Array> {
  const gruppiParte = raggruppaParti(chapters);
  const pagineIndice = calcolaPagineIndice(chapters);
  const documento = (
    <Document
      title={`${meta.projectTitle}${meta.volume ? ` — ${meta.volume}` : ''}`}
      author={meta.author}
      creator="AI Editorial Factory"
      producer="AI Editorial Factory"
      language="it"
    >
      {/* Copertina fronte, se approvata; altrimenti frontespizio tipografico. */}
      {!options.chapterExtract && meta.frontCoverDataUrl ? (
        <Page size="A4" style={{ padding: 0 }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={meta.frontCoverDataUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </Page>
      ) : !options.chapterExtract ? <Page size="A4" style={styles.page}>
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
      </Page> : null}

      {/* Indice */}
      {!options.chapterExtract && chapters.length > 0 ? (
        <Page size="A4" style={styles.page}>
          <Testatina meta={meta} label="SOMMARIO" accent={meta.accentColor ?? colori.accento} />
          <Text style={styles.titolo}>Indice</Text>
          {gruppiParte.map((parte) => (
            <View key={`toc-parte-${parte.key}`} style={{ marginBottom: 14 }}>
              {parte.title ? (
                <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 12, color: meta.accentColor ?? colori.accento, marginBottom: 6 }}>
                  {parte.number ? `PARTE ${parte.number} — ` : ''}{parte.title.toUpperCase()}
                </Text>
              ) : null}
              {parte.chapters.map((capitolo, indice) => (
                <View key={`toc-${parte.key}-${indice}`} style={{ ...styles.vocElenco, marginLeft: parte.title ? 12 : 0 }}>
                  <Text style={{ ...styles.segno, width: 74, fontFamily: 'Helvetica', fontSize: 9 }}>{capitolo.label}</Text>
                  <Text style={styles.vocTesto}>{capitolo.title}{capitolo.approved ? '' : '  (bozza)'}</Text>
                  <Text style={{ width: 28, textAlign: 'right', fontFamily: 'Helvetica-Bold' }}>{pagineIndice.get(capitolo) ?? ''}</Text>
                </View>
              ))}
            </View>
          ))}
          <PiePagina meta={meta} numerazione="romana" />
        </Page>
      ) : null}

      {/* Capitoli */}
      {chapters.map((capitolo, indice) => {
        const albero = parsePdfMarkdown(capitolo.contentMd, capitolo.title);
        const numero = numeroCapitolo(capitolo.label, indice);
        const accent = meta.accentColor ?? colori.accento;
        const obiettivi = vociObiettivo(albero);
        const esclusi = nodiSezioneObiettivi(albero);
        const contenuto = albero.children.filter((node) => !esclusi.has(node));
        const sezioni = suddividiSottocapitoli(contenuto);
        let indiceFigura = 0;

        return (
          <React.Fragment key={`cap-${indice}`}>
            {!options.chapterExtract && (indice === 0 || chapters[indice - 1]?.partId !== capitolo.partId) && capitolo.partTitle ? (
              <Page size="A4" style={styles.page}>
                <Testatina meta={meta} label={`PARTE ${capitolo.partNumber ?? ''} · ${capitolo.partTitle}`} accent={accent} />
                <Text style={{ fontSize: 11, color: accent, fontFamily: 'Helvetica-Bold', letterSpacing: 1, marginTop: 100 }}>
                  PARTE {capitolo.partNumber ?? ''}
                </Text>
                <Text style={{ fontSize: 34, lineHeight: 1.12, fontFamily: 'Helvetica-Bold', marginTop: 18, marginBottom: 34 }}>
                  {capitolo.partTitle}
                </Text>
                <Text style={{ ...styles.obiettiviTitolo, color: accent, borderBottomColor: accent }}>CAPITOLI DELLA PARTE</Text>
                {chapters.filter((voce) => voce.partId === capitolo.partId).map((voce) => (
                  <View key={`parte-cap-${voce.label}`} style={{ flexDirection: 'row', marginBottom: 10 }}>
                    <Text style={{ width: 78, color: accent, fontFamily: 'Helvetica-Bold' }}>{voce.label}</Text>
                    <Text style={{ flex: 1 }}>{voce.title}</Text>
                  </View>
                ))}
                <PiePagina meta={meta} numerazione="araba" />
              </Page>
            ) : null}
            <Page size="A4" style={styles.page}>
              <Testatina meta={meta} label={`${numero} · ${capitolo.title.toUpperCase()}`} accent={accent} />
              <Text style={styles.aperturaNumero}>{numero}</Text>
              <View style={styles.aperturaCorpo}>
                <Text style={{ ...styles.aperturaLabel, color: accent }}>CAPITOLO {numero}</Text>
                <Text style={styles.aperturaTitolo}>{capitolo.title}</Text>
                {testoIntroduzione(albero) ? (
                  <Text style={styles.aperturaSottotitolo}>{testoIntroduzione(albero)}</Text>
                ) : null}
                <SchemaCapitolo
                  numero={numero}
                  concetti={concettiCapitolo(albero, capitolo.title)}
                  accent={meta.accentColor ?? colori.accento}
                />
                <Text style={{ ...styles.obiettiviTitolo, color: accent, borderBottomColor: accent }}>IN QUESTO CAPITOLO · OBIETTIVI</Text>
                <View style={styles.obiettiviRiga}>
                  {(obiettivi.length > 0 ? obiettivi : ['Comprendere i concetti chiave', 'Applicare il procedimento', 'Verificare il risultato']).map((voce, i) => (
                    <View key={`ob-${indice}-${i}`} style={styles.obiettivo}>
                      <Text style={{ ...styles.iconaNumero, backgroundColor: accent }}>{String(i + 1).padStart(2, '0')}</Text>
                      <Text style={{ flex: 1 }}>{voce}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <PiePagina meta={meta} numerazione="araba" offset={options.chapterExtract ? 0 : 2} />
            </Page>

            {sezioni.map((sezione, sezioneIndice) => (
              <Page key={`c${indice}-s${sezioneIndice}`} size="A4" style={{ ...styles.page, paddingTop: 72 }}>
                <Testatina meta={meta} label={`${numero} · ${capitolo.title.toUpperCase()}`} accent={accent} />
                {sezione.map((node, nodeIndice) => {
                  if (node.type === 'blockquote') {
                    return <CalloutPagina key={`c${indice}-s${sezioneIndice}-n${nodeIndice}`} node={node} />;
                  }
                  if (segnapostoImmagine(node)) {
                    const figura = capitolo.figures[indiceFigura++];
                    return figura
                      ? renderFigure(figura, `c${indice}-s${sezioneIndice}-img${nodeIndice}`)
                      : <SchemaCapitolo key={`schema-${indice}-${sezioneIndice}-${nodeIndice}`} numero={numero} concetti={concettiCapitolo(albero, capitolo.title)} accent={accent} />;
                  }
                  return renderBlock(node, `c${indice}-s${sezioneIndice}-n${nodeIndice}`);
                })}
                {sezioneIndice === sezioni.length - 1
                  ? capitolo.figures.slice(indiceFigura).map((figura, i) => renderFigure(figura, `c${indice}-extra${i}`))
                  : null}
                <PiePagina meta={meta} numerazione="araba" offset={options.chapterExtract ? 0 : 2} />
              </Page>
            ))}
            {options.chapterExtract && (capitolo.citations?.length ?? 0) > 0 ? (
              <Page size="A4" style={{ ...styles.page, paddingTop: 72 }}>
                <Testatina meta={meta} label={`${numero} · RIFERIMENTI`} accent={accent} />
                <View style={styles.riferimenti}>
                  <Text style={styles.titoloRiferimenti}>Riferimenti</Text>
                  {capitolo.citations!.map((citation, citationIndex) => (
                    <Text key={`cap-ref-${citationIndex}`} style={styles.riferimento}>
                      {citationIndex + 1}. {citation.title || citation.publisher || citation.url} — {citation.url}
                      {citation.isOfficial ? ' (documentazione ufficiale)' : ''}
                    </Text>
                  ))}
                </View>
                <PiePagina meta={meta} numerazione="araba" offset={0} />
              </Page>
            ) : null}
          </React.Fragment>
        );
      })}

      {/* Un volume senza capitoli convalidati lo dice, invece di essere vuoto */}
      {chapters.length === 0 ? (
        <Page size="A4" style={styles.page}>
          <Testatina meta={meta} label="CONTENUTO" accent={meta.accentColor ?? colori.accento} />
          <Text style={styles.titolo}>Nessun capitolo scritto</Text>
          <Text style={styles.paragrafo}>
            L’anteprima raccoglie tutto ciò che è stato scritto, approvato o no. Avvia l’audit su un
            capitolo e comparirà qui.
          </Text>
          <PiePagina meta={meta} numerazione="araba" />
        </Page>
      ) : null}

      {!options.chapterExtract && meta.backCoverDataUrl ? (
        <Page size="A4" style={{ padding: 0 }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={meta.backCoverDataUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
  options: VolumePdfOptions = {},
): Promise<Uint8Array> {
  const gruppiParte = raggruppaParti(chapters);
  const pagineIndice = calcolaPagineIndice(chapters);
  const documento = (
    <Document
      title={pulisciTestoPdf(meta.projectTitle)}
      author={pulisciTestoPdf(meta.author)}
      creator="AI Editorial Factory"
    >
      {!options.chapterExtract && meta.frontCoverDataUrl ? (
        <Page size="A4" style={{ padding: 0 }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={meta.frontCoverDataUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </Page>
      ) : !options.chapterExtract ? <Page size="A4" style={{ padding: 56, fontFamily: 'Helvetica', fontSize: 10 }}>
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
      </Page> : null}

      {!options.chapterExtract ? <Page size="A4" style={styles.page}>
        <Testatina meta={meta} label="SOMMARIO" accent={meta.accentColor ?? colori.accento} />
        <Text style={styles.titolo}>Indice</Text>
        {gruppiParte.map((parte) => (
          <View key={`safe-toc-${parte.key}`} style={{ marginBottom: 12 }}>
            {parte.title ? <Text style={{ fontFamily: 'Helvetica-Bold', color: meta.accentColor ?? colori.accento, marginBottom: 5 }}>{parte.number ? `PARTE ${parte.number} — ` : ''}{parte.title}</Text> : null}
            {parte.chapters.map((capitolo) => <View key={`safe-toc-${capitolo.label}`} style={{ flexDirection: 'row', marginLeft: parte.title ? 12 : 0, marginBottom: 4 }}><Text style={{ flex: 1 }}>{capitolo.label} — {capitolo.title}</Text><Text style={{ width: 28, textAlign: 'right' }}>{pagineIndice.get(capitolo) ?? ''}</Text></View>)}
          </View>
        ))}
        <PiePagina meta={meta} numerazione="romana" />
      </Page> : null}

      {chapters.map((chapter, indice) => {
        const tree = parsePdfMarkdown(chapter.contentMd, chapter.title);
        const numero = numeroCapitolo(chapter.label, indice);
        const accent = meta.accentColor ?? colori.accento;
        const obiettivi = vociObiettivo(tree);
        const esclusi = nodiSezioneObiettivi(tree);
        const sezioniSicure = suddividiSottocapitoli(tree.children.filter((node) => !esclusi.has(node))).map((sezione) => ({
          callout: sezione.filter((node): node is Extract<RootContent, { type: 'blockquote' }> => node.type === 'blockquote').slice(0, 3),
          pagine: suddividiTestoLineare(
            sezione.filter((node) => node.type !== 'blockquote').map(testoBloccoLineare).filter(Boolean).join('\n\n'),
            4200,
          ),
        }));
        const voci = obiettivi.length > 0
          ? obiettivi
          : ['Comprendere i concetti chiave', 'Applicare il procedimento', 'Verificare il risultato'];

        return (
          <React.Fragment key={`safe-${indice}`}>
            {!options.chapterExtract && (indice === 0 || chapters[indice - 1]?.partId !== chapter.partId) && chapter.partTitle ? (
              <Page size="A4" style={styles.page}>
                <Testatina meta={meta} label={`PARTE ${chapter.partNumber ?? ''} · ${chapter.partTitle}`} accent={accent} />
                <Text style={{ marginTop: 110, fontFamily: 'Helvetica-Bold', fontSize: 11, color: accent }}>PARTE {chapter.partNumber ?? ''}</Text>
                <Text style={{ marginTop: 18, marginBottom: 30, fontFamily: 'Helvetica-Bold', fontSize: 32 }}>{chapter.partTitle}</Text>
                {chapters.filter((voce) => voce.partId === chapter.partId).map((voce) => <Text key={`safe-part-${voce.label}`} style={{ marginBottom: 8 }}>{voce.label} — {voce.title}</Text>)}
                <PiePagina meta={meta} numerazione="araba" />
              </Page>
            ) : null}
            {/* Anche il renderer di sicurezza conserva l'apertura editoriale:
                il lettore non deve poter ricadere nel vecchio PDF lineare. */}
            <Page size="A4" style={styles.page}>
              <Testatina meta={meta} label={`${numero} · ${pulisciTestoPdf(chapter.title.toUpperCase()).slice(0, 110)}`} accent={accent} />
              <Text style={styles.aperturaNumero}>{numero}</Text>
              <View style={styles.aperturaCorpo}>
                <Text style={{ ...styles.aperturaLabel, color: accent }}>CAPITOLO {numero}</Text>
                <Text style={styles.aperturaTitolo}>{pulisciTestoPdf(chapter.title)}</Text>
                {testoIntroduzione(tree) ? (
                  <Text style={styles.aperturaSottotitolo}>{testoIntroduzione(tree)}</Text>
                ) : null}
                <SchemaCapitolo
                  numero={numero}
                  concetti={concettiCapitolo(tree, chapter.title)}
                  accent={meta.accentColor ?? colori.accento}
                />
                <Text style={{ ...styles.obiettiviTitolo, color: accent, borderBottomColor: accent }}>IN QUESTO CAPITOLO · OBIETTIVI</Text>
                <View style={styles.obiettiviRiga}>
                  {voci.slice(0, 6).map((voce, i) => (
                    <View key={`safe-ob-${indice}-${i}`} style={styles.obiettivo}>
                      <Text style={{ ...styles.iconaNumero, backgroundColor: accent }}>{String(i + 1).padStart(2, '0')}</Text>
                      <Text style={{ flex: 1 }}>{pulisciTestoPdf(voce).slice(0, 180)}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <PiePagina meta={meta} numerazione="araba" offset={options.chapterExtract ? 0 : 2} />
            </Page>

            {sezioniSicure.flatMap((sezione, sezioneIndice) => sezione.pagine.map((testoPagina, paginaIndice) => (
              <Page key={`safe-page-${indice}-${sezioneIndice}-${paginaIndice}`} size="A4" style={{ ...styles.page, paddingTop: 72 }}>
                <Testatina meta={meta} label={`${numero} · ${pulisciTestoPdf(chapter.title.toUpperCase()).slice(0, 110)}`} accent={accent} />
                {/* Un unico nodo Text, già paginato e limitato: niente liste o
                    box annidati da cui Yoga possa ricavare coordinate infinite. */}
                {paginaIndice === 0 ? sezione.callout.map((node, calloutIndice) => (
                  <CalloutPagina key={`safe-callout-${indice}-${calloutIndice}`} node={node} maxLength={620} />
                )) : null}
                <Text style={{ fontSize: 9.5, lineHeight: 1.55, textAlign: 'justify' }}>
                  {testoPagina}
                </Text>
                <PiePagina meta={meta} numerazione="araba" offset={options.chapterExtract ? 0 : 2} />
              </Page>
            )))}
          </React.Fragment>
        );
      })}
      {!options.chapterExtract && meta.backCoverDataUrl ? (
        <Page size="A4" style={{ padding: 0 }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={meta.backCoverDataUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </Page>
      ) : null}
    </Document>
  );

  const buffer = await renderToBuffer(documento);
  return new Uint8Array(buffer);
}

interface GruppoParte {
  key: string;
  number: number | null;
  title: string | null;
  chapters: VolumeChapterInput[];
}

function raggruppaParti(chapters: VolumeChapterInput[]): GruppoParte[] {
  const gruppi = new Map<string, GruppoParte>();
  for (const chapter of chapters) {
    const key = chapter.partId ?? '__senza_parte__';
    const gruppo = gruppi.get(key) ?? {
      key,
      number: chapter.partNumber ?? null,
      title: chapter.partTitle ?? null,
      chapters: [],
    };
    gruppo.chapters.push(chapter);
    gruppi.set(key, gruppo);
  }
  return Array.from(gruppi.values());
}

/** Pagina araba di apertura di ogni capitolo, contando le pagine editoriali. */
function calcolaPagineIndice(chapters: VolumeChapterInput[]): Map<VolumeChapterInput, number> {
  const pagine = new Map<VolumeChapterInput, number>();
  let pagina = 1;
  for (const [indice, chapter] of chapters.entries()) {
    const nuovaParte = (indice === 0 || chapters[indice - 1]?.partId !== chapter.partId) && chapter.partTitle;
    if (nuovaParte) pagina += 1;
    pagine.set(chapter, pagina);
    const tree = parsePdfMarkdown(chapter.contentMd, chapter.title);
    const esclusi = nodiSezioneObiettivi(tree);
    const sezioni = suddividiSottocapitoli(tree.children.filter((node) => !esclusi.has(node)));
    pagina += 1 + sezioni.length;
  }
  return pagine;
}

function DiagrammaMermaid({ source }: { source: string }) {
  const etichette = new Map<string, string>();
  const patternNodo = /\b([A-Za-z][\w-]*)\s*(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\})/g;
  for (const match of source.matchAll(patternNodo)) {
    const id = match[1];
    if (!id) continue;
    etichette.set(id, (match[2] ?? match[3] ?? match[4] ?? id).replace(/["']/g, '').trim());
  }
  const archi = Array.from(source.matchAll(/\b([A-Za-z][\w-]*)\s*(?:--+>|==+>|-.+?->)\s*(?:\|[^|]*\|\s*)?([A-Za-z][\w-]*)/g))
    .map((match) => [match[1]!, match[2]!] as const)
    .slice(0, 10);
  const ids = Array.from(new Set(archi.flat())).slice(0, 8);
  const nodi = ids.length > 0 ? ids : Array.from(etichette.keys()).slice(0, 8);

  return (
    <View style={{ borderWidth: 1, borderColor: '#bfd3eb', borderRadius: 8, backgroundColor: '#f7fbff', padding: 14, marginBottom: 6 }}>
      <Text style={{ fontSize: 7.5, color: '#3568a8', fontFamily: 'Helvetica-Bold', marginBottom: 10 }}>DIAGRAMMA</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
        {nodi.map((id, index) => (
          <React.Fragment key={`mermaid-${id}-${index}`}>
            <View style={{ width: '27%', minHeight: 42, borderWidth: 1.5, borderColor: '#4285f4', borderRadius: 6, backgroundColor: '#ffffff', padding: 7, justifyContent: 'center', marginVertical: 5 }}>
              <Text style={{ color: '#163a70', fontSize: 8, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>
                {(etichette.get(id) ?? id).slice(0, 48)}
              </Text>
            </View>
            {index < nodi.length - 1 ? (
              <View style={{ width: '8%', alignItems: 'center' }}><Text style={{ color: '#4285f4', fontSize: 14 }}>{'>'}</Text></View>
            ) : null}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

function Testatina({ meta, label, accent }: { meta: VolumeMeta; label: string; accent: string }) {
  return (
    <View style={{ ...styles.testatina, borderBottomColor: accent }} fixed>
      <Text style={{ flex: 1, paddingRight: 12 }}>{pulisciTestoPdf(label).slice(0, 115)}</Text>
      {meta.toolLogoDataUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image src={meta.toolLogoDataUrl} style={{ width: 62, height: 14, objectFit: 'contain', objectPosition: 'right center' }} />
      ) : null}
    </View>
  );
}

function PiePagina({ meta, numerazione, offset }: { meta: VolumeMeta; numerazione: 'romana' | 'araba'; offset?: number }) {
  return (
    <>
      <View style={styles.piede} fixed>
        <Text style={{ width: '78%', textAlign: 'left' }}>
          {pulisciTestoPdf(meta.volumeTitle || meta.projectTitle).slice(0, 90)}
        </Text>
      </View>
      <Text
        style={styles.numeroPagina}
        fixed
        render={({ pageNumber }) => {
          const numero = Math.max(1, pageNumber - (offset ?? (numerazione === 'romana' ? 1 : 2)));
          return numerazione === 'romana' ? numeroRomano(numero).toLowerCase() : String(numero);
        }}
      />
    </>
  );
}

function numeroRomano(value: number): string {
  const simboli: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let resto = Math.max(1, Math.floor(value));
  let risultato = '';
  for (const [numero, simbolo] of simboli) {
    while (resto >= numero) { risultato += simbolo; resto -= numero; }
  }
  return risultato;
}

function numeroCapitolo(label: string, indice: number): string {
  return /\d+/.exec(label)?.[0]?.padStart(2, '0') ?? String(indice + 1).padStart(2, '0');
}

function testoIntroduzione(albero: Root): string | null {
  const paragrafo = albero.children.find((node) => node.type === 'paragraph');
  return paragrafo?.type === 'paragraph' ? plainInline(paragrafo.children).slice(0, 220) : null;
}

function vociObiettivo(albero: Root): string[] {
  const indiceTitolo = albero.children.findIndex(
    (node) => node.type === 'heading' && /obiettiv/i.test(plainInline(node.children)),
  );
  if (indiceTitolo >= 0) {
    for (const node of albero.children.slice(indiceTitolo + 1)) {
      if (node.type === 'heading') break;
      if (node.type === 'list') {
        return node.children.slice(0, 6).map((item) => plainBlockText(item).trim()).filter(Boolean);
      }
    }
  }

  const calloutObiettivi = albero.children.find(
    (node): node is Extract<RootContent, { type: 'blockquote' }> =>
      node.type === 'blockquote' && /obiettiv/i.test(plainBlockText(node)),
  );
  const listaCallout = calloutObiettivi?.children.find((node) => node.type === 'list');
  if (listaCallout?.type === 'list') {
    return listaCallout.children.slice(0, 6).map((item) => plainBlockText(item).trim()).filter(Boolean);
  }
  return [];
}

function nodiSezioneObiettivi(albero: Root): Set<RootContent> {
  const esclusi = new Set<RootContent>();
  for (let indice = 0; indice < albero.children.length; indice += 1) {
    const node = albero.children[indice];
    if (!node) continue;
    if (node.type === 'blockquote' && /obiettiv/i.test(plainBlockText(node))) esclusi.add(node);
    if (node.type !== 'heading' || !/obiettiv/i.test(plainInline(node.children))) continue;
    esclusi.add(node);
    for (const successivo of albero.children.slice(indice + 1)) {
      if (successivo.type === 'heading') break;
      esclusi.add(successivo);
      // Il blocco obiettivi termina con il suo elenco. Il testo che segue,
      // anche senza un nuovo titolo, appartiene già al capitolo.
      if (successivo.type === 'list') break;
    }
  }
  return esclusi;
}

/** Il testo prima del primo H2 è una sezione; ogni H2 successivo apre pagina. */
function suddividiSottocapitoli(nodes: RootContent[]): RootContent[][] {
  const sezioni: RootContent[][] = [];
  let corrente: RootContent[] = [];
  for (const node of nodes) {
    if (node.type === 'heading' && node.depth === 2 && corrente.length > 0) {
      sezioni.push(corrente);
      corrente = [];
    }
    corrente.push(node);
  }
  if (corrente.length > 0) sezioni.push(corrente);
  return sezioni.length > 0 ? sezioni : [[]];
}

function segnapostoImmagine(node: RootContent): boolean {
  return node.type === 'paragraph' && /^\s*\[(?:IMMAGINE|FIGURA)\s*:/i.test(plainInline(node.children));
}

/**
 * Trasforma qualunque blocco Markdown in testo finito e prevedibile. Questo è
 * usato soltanto dall'ultima rete di sicurezza: preserva tutto il contenuto,
 * ma rimuove la geometria annidata che può mandare Yoga fuori scala.
 */
function testoBloccoLineare(node: RootContent): string {
  switch (node.type) {
    case 'heading':
      return plainInline(node.children).toUpperCase();
    case 'paragraph':
      return segnapostoImmagine(node) ? '' : plainInline(node.children);
    case 'code':
      return `${node.lang ? `[${node.lang.toUpperCase()}]\n` : ''}${node.value}`;
    case 'blockquote':
      return `NOTA — ${node.children.map(testoBloccoLineare).join('\n')}`;
    case 'list':
      return node.children
        .map((item, index) => `${node.ordered ? `${(node.start ?? 1) + index}.` : '•'} ${plainBlockText(item)}`)
        .join('\n');
    case 'table':
      return node.children
        .map((row) => row.children.map((cell) => plainInline(cell.children)).join('  ·  '))
        .join('\n');
    case 'thematicBreak':
      return '────────────────────────';
    default:
      return '';
  }
}

/** Pagine corte per costruzione; spezza anche righe e token patologici. */
function suddividiTestoLineare(value: string, maxCaratteri = 2200): string[] {
  const testo = pulisciTestoPdf(value)
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!testo) return ['Nessun contenuto disponibile per questo capitolo.'];

  const pagine: string[] = [];
  let corrente = '';
  for (const paragrafoOriginale of testo.split(/\n\n+/)) {
    let residuo = paragrafoOriginale;
    while (residuo.length > maxCaratteri) {
      const spazio = residuo.lastIndexOf(' ', maxCaratteri);
      const taglio = spazio > maxCaratteri * 0.6 ? spazio : maxCaratteri;
      const pezzo = residuo.slice(0, taglio).trim();
      if (corrente) pagine.push(corrente.trim());
      pagine.push(pezzo);
      corrente = '';
      residuo = residuo.slice(taglio).trim();
    }
    const candidato = corrente ? `${corrente}\n\n${residuo}` : residuo;
    if (candidato.length > maxCaratteri && corrente) {
      pagine.push(corrente.trim());
      corrente = residuo;
    } else {
      corrente = candidato;
    }
  }
  if (corrente.trim()) pagine.push(corrente.trim());
  return pagine;
}

function concettiCapitolo(albero: Root, titolo: string): string[] {
  const titoli = albero.children
    .filter((node): node is Extract<RootContent, { type: 'heading' }> => node.type === 'heading' && node.depth >= 2)
    .map((node) => plainInline(node.children).replace(/^\d+(?:\.\d+)*\s*/, '').trim())
    .filter((voce) => voce && !/obiettiv/i.test(voce));
  const paroleTitolo = titolo.split(/\s+/).filter((voce) => voce.length >= 4);
  return [...titoli, ...paroleTitolo, 'RISULTATO']
    .map((voce) => voce.toUpperCase().slice(0, 18))
    .filter((voce, indice, tutte) => tutte.indexOf(voce) === indice)
    .slice(0, 3);
}

function SchemaCapitolo({ numero, concetti, accent }: { numero: string; concetti: string[]; accent: string }) {
  const etichette = [...concetti, 'RISULTATO'].slice(0, 3);
  return (
    <View style={styles.schemaApertura}>
      <View style={styles.schemaRiga}>
        <View style={{ ...styles.schemaNodo, borderColor: accent }}><Text style={{ color: accent, fontSize: 7.5, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>{etichette[0]}</Text></View>
        <View style={{ ...styles.schemaLinea, borderTopColor: accent }} />
        <View style={{ ...styles.schemaCentro, backgroundColor: accent }}><Text style={{ color: '#ffffff', fontFamily: 'Helvetica-Bold', fontSize: 14 }}>{numero}</Text></View>
        <View style={{ ...styles.schemaLinea, borderTopColor: accent }} />
        <View style={{ ...styles.schemaNodo, borderColor: accent, borderRadius: 25 }}><Text style={{ color: accent, fontSize: 7.5, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>{etichette[1]}</Text></View>
        <View style={{ ...styles.schemaLinea, borderTopColor: accent }} />
        <View style={{ ...styles.schemaNodo, borderColor: accent }}><Text style={{ color: accent, fontSize: 7.5, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>{etichette[2]}</Text></View>
      </View>
    </View>
  );
}

function CalloutPagina({ node, maxLength }: { node: Extract<RootContent, { type: 'blockquote' }>; maxLength?: number }) {
  const contenuto = plainBlockText(node);
  const tipo = /\b(errore comune|common error|anti-?pattern)\b/i.test(contenuto) ? 'errore'
    : /\b(att(?:enzione)?|warning)\b/i.test(contenuto) ? 'attenzione'
      : /\b(buona pratica|best practice)\b/i.test(contenuto) ? 'buonaPratica'
        : /\b(approfondimento|deep dive)\b/i.test(contenuto) ? 'approfondimento'
          : /\b(importante|important)\b/i.test(contenuto) ? 'importante'
            : 'nota';
  const configurazione = {
    importante: { icona: 'i', etichetta: 'IMPORTANTE', colore: '#175cd3', fondo: '#edf4ff' },
    attenzione: { icona: '!', etichetta: 'ATTENZIONE', colore: '#e85d2a', fondo: '#fff4ec' },
    nota: { icona: 'DOC', etichetta: 'NOTA', colore: '#2997d6', fondo: '#eef9ff' },
    buonaPratica: { icona: 'OK', etichetta: 'BUONA PRATICA', colore: '#198754', fondo: '#edf9f2' },
    approfondimento: { icona: 'B', etichetta: 'APPROFONDIMENTO', colore: '#7c3aed', fondo: '#f5f0ff' },
    errore: { icona: 'x', etichetta: 'ERRORE COMUNE', colore: '#d92d20', fondo: '#fff0ef' },
  }[tipo];
  return (
    <View style={{ borderLeftWidth: 4, borderLeftColor: configurazione.colore, borderRadius: 5, backgroundColor: configurazione.fondo, paddingTop: 12, paddingBottom: 13, paddingHorizontal: 14, marginVertical: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 9 }}>
        <View style={{ width: 27, height: 27, borderWidth: 1.5, borderColor: configurazione.colore, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginRight: 7 }}>
          <Text style={{ color: configurazione.colore, fontFamily: 'Helvetica-Bold', fontSize: configurazione.icona.length > 1 ? 6 : 13 }}>
            {configurazione.icona}
          </Text>
        </View>
        <Text style={{ ...styles.calloutEtichetta, color: configurazione.colore, fontSize: 9 }}>
          {configurazione.etichetta}
        </Text>
      </View>
      <Text style={{ fontSize: 9, lineHeight: 1.45 }}>
        {contenuto.replace(/^\s*(NOTA|ATTENZIONE|WARNING|IMPORTANTE|BUONA PRATICA|APPROFONDIMENTO|ERRORE COMUNE)\s*/i, '').slice(0, maxLength)}
      </Text>
    </View>
  );
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

