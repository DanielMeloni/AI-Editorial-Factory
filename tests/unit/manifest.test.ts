import { describe, expect, it } from 'vitest';
import { extractArchive } from '@/lib/ingest/archive';
import { buildManifest, resolveRelativePath } from '@/lib/ingest/manifest';
import { analyzeMarkdown } from '@/lib/ingest/markdown';
import { buildDataformFixture } from '../fixtures/build-fixture';

async function manifestoDiProva(options?: Parameters<typeof buildDataformFixture>[0]) {
  const extraction = await extractArchive(buildDataformFixture(options));
  return buildManifest(extraction.files);
}

describe('manifesto del volume pilota', () => {
  it('legge titolo, sottotitolo, autore e volume dal front matter dell’indice', async () => {
    const manifest = await manifestoDiProva();
    expect(manifest.title).toBe('Dataform in Pratica');
    expect(manifest.subtitle).toBe('Dalla prima pipeline alla produzione');
    expect(manifest.author).toBe('Daniel Meloni');
    expect(manifest.volume).toBe('Volume 1');
    expect(manifest.indexPath).toBe('README.md');
  });

  it('riconosce 30 capitoli e 10 appendici', async () => {
    const manifest = await manifestoDiProva();
    expect(manifest.stats.chapterCount).toBe(30);
    expect(manifest.stats.appendixCount).toBe(10);
  });

  it('raggruppa i capitoli in parti ordinate', async () => {
    const manifest = await manifestoDiProva();
    expect(manifest.parts.map((p) => p.title)).toEqual([
      'Fondamenti', 'Modellazione', 'Produzione', 'Avanzato', 'Appendici',
    ]);
  });

  it('ordina i capitoli per numero, non alfabeticamente', async () => {
    const manifest = await manifestoDiProva();
    const numeri = manifest.parts
      .flatMap((p) => p.chapters)
      .filter((c) => c.kind === 'part')
      .map((c) => c.number);

    expect(numeri).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('rende il capitolo 11 individuabile con i suoi dati', async () => {
    const manifest = await manifestoDiProva();
    const capitolo11 = manifest.parts
      .flatMap((p) => p.chapters)
      .find((c) => c.kind === 'part' && c.number === 11);

    expect(capitolo11).toBeDefined();
    expect(capitolo11!.title).toContain('Incremental Tables');
    expect(capitolo11!.sourcePath).toBe('02-modellazione/capitolo-11-incremental-tables.md');
    expect(capitolo11!.codeBlockCount).toBe(2);
    expect(capitolo11!.codeLanguages).toEqual(['javascript', 'sqlx']);
    expect(capitolo11!.placeholderCount).toBe(1);
    expect(capitolo11!.linkCount).toBe(1);
    expect(capitolo11!.wordCount).toBeGreaterThan(50);
  });

  it('numera le appendici dalla A alla J', async () => {
    const manifest = await manifestoDiProva();
    const etichette = manifest.parts
      .flatMap((p) => p.chapters)
      .filter((c) => c.kind === 'appendix')
      .map((c) => c.label);

    expect(etichette).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  });

  it('assegna un ordine globale progressivo e senza salti', async () => {
    const manifest = await manifestoDiProva();
    const ordini = manifest.parts.flatMap((p) => p.chapters).map((c) => c.orderIndex);
    expect(ordini).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it('aggrega parole, blocchi di codice e figure', async () => {
    const manifest = await manifestoDiProva();
    expect(manifest.stats.wordCount).toBeGreaterThan(2000);
    expect(manifest.stats.codeBlockCount).toBeGreaterThanOrEqual(41);
    expect(manifest.stats.figureCount).toBe(30);
    expect(manifest.stats.assetCount).toBeGreaterThan(30);
  });
});

describe('confronto fra indice dichiarato e struttura reale', () => {
  it('su un archivio coerente non segnala differenze bloccanti', async () => {
    const manifest = await manifestoDiProva();
    const gravi = manifest.discrepancies.filter((d) => d.severity === 'error');
    expect(gravi).toEqual([]);
  });

  it('segnala un capitolo citato dall’indice ma assente dall’archivio', async () => {
    const manifest = await manifestoDiProva({ withBrokenIndexReference: true });
    const problema = manifest.discrepancies.find(
      (d) => d.kind === 'indice_riferisce_file_inesistente',
    );

    expect(problema).toBeDefined();
    expect(problema!.severity).toBe('error');
    expect(problema!.path).toBe('01-fondamenti/capitolo-99-fantasma.md');
  });

  it('segnala un’immagine citata ma non presente', async () => {
    const manifest = await manifestoDiProva({ withMissingFigure: true });
    const problema = manifest.discrepancies.find((d) => d.kind === 'immagine_mancante');

    expect(problema).toBeDefined();
    expect(problema!.path).toBe('assets/figura-11.png');
    expect(manifest.stats.missingFigureCount).toBe(1);
  });
});

describe('risoluzione dei percorsi relativi', () => {
  it.each([
    ['02-modellazione', '../assets/figura-11.png', 'assets/figura-11.png'],
    ['02-modellazione', './figura.png', '02-modellazione/figura.png'],
    ['', 'assets/x.png', 'assets/x.png'],
    ['a/b', '../../c/d.png', 'c/d.png'],
    ['a', 'https://esempio.it/x.png', 'https://esempio.it/x.png'],
  ])('da %s risolve %s in %s', (from, target, expected) => {
    expect(resolveRelativePath(from, target)).toBe(expected);
  });
});

describe('analisi del Markdown', () => {
  it('non conta come testo il contenuto dei blocchi di codice', () => {
    const analisi = analyzeMarkdown('# Titolo\n\nUna parola.\n\n```sql\nselect molte parole qui dentro\n```\n');
    expect(analisi.codeBlocks).toHaveLength(1);
    expect(analisi.wordCount).toBe(3); // Titolo, Una, parola
  });

  it('non chiude un blocco a quattro backtick con tre backtick interni', () => {
    const analisi = analyzeMarkdown('````md\n```\nesempio annidato\n```\n````\n');
    expect(analisi.codeBlocks).toHaveLength(1);
    expect(analisi.codeBlocks[0]!.content).toContain('esempio annidato');
  });

  it('riconosce titoli, figure, segnaposto, collegamenti e callout', () => {
    const analisi = analyzeMarkdown(
      [
        '# Capitolo',
        '## Sezione',
        '![Figura](img/a.png)',
        '[IMMAGINE: schema del flusso]',
        '<!-- TODO: illustrazione di copertina -->',
        'Vedi [la documentazione](https://esempio.it).',
        '> [!WARNING]',
        '> Attenzione.',
      ].join('\n'),
    );

    expect(analisi.title).toBe('Capitolo');
    expect(analisi.headings).toHaveLength(2);
    expect(analisi.figures[0]).toMatchObject({ alt: 'Figura', src: 'img/a.png' });
    expect(analisi.placeholders).toHaveLength(2);
    expect(analisi.placeholders[0]!.description).toBe('schema del flusso');
    expect(analisi.links).toHaveLength(1);
    expect(analisi.callouts[0]!.kind).toBe('WARNING');
  });

  it('preferisce il titolo dichiarato nel front matter', () => {
    const analisi = analyzeMarkdown('---\ntitle: Titolo ufficiale\n---\n\n# Titolo nel corpo\n');
    expect(analisi.title).toBe('Titolo ufficiale');
    expect(analisi.frontMatter.title).toBe('Titolo ufficiale');
  });
});
