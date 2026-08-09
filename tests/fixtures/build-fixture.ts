import { zipSync, strToU8 } from 'fflate';

/**
 * Costruisce in memoria un archivio che riproduce la forma del volume pilota
 * «Dataform in Pratica»: parti numerate, 30 capitoli, 10 appendici, asset,
 * script e un indice.
 *
 * Il contenuto è sintetico. Nessun testo reale del manuale entra nel
 * repository: la fixture serve a verificare il riconoscimento della struttura,
 * non a riprodurre l'opera.
 */

const CHAPTER_TITLES: Record<number, string> = {
  1: 'Che cos’è Dataform',
  2: 'Installazione e primo progetto',
  3: 'Il file dataform.json',
  4: 'Definizioni e dichiarazioni',
  5: 'Le tabelle',
  6: 'Le viste',
  7: 'Il grafo delle dipendenze',
  8: 'Asserzioni di qualità',
  9: 'Variabili e JavaScript',
  10: 'Include riutilizzabili',
  11: 'Incremental Tables',
  12: 'Partizionamento e clustering',
  13: 'Tag e selezione parziale',
  14: 'Ambienti e workspace',
  15: 'Pianificazione delle esecuzioni',
};

function chapterBody(number: number, title: string): string {
  const isEleven = number === 11;
  return `# Capitolo ${number} — ${title}

## Obiettivi

Al termine di questo capitolo saprai riconoscere ${title.toLowerCase()} e applicarlo a una pipeline reale.

## Spiegazione

Testo sintetico di esempio per il capitolo ${number}. Serve a verificare il conteggio
delle parole e il riconoscimento della struttura editoriale del manuale.

${isEleven ? '> [!NOTE]\n> Le tabelle incrementali riducono il costo di elaborazione.\n' : ''}
## Esempio

\`\`\`sqlx
config {
  type: "${isEleven ? 'incremental' : 'table'}",
  schema: "analytics"
}

select
  event_date,
  count(*) as eventi
from \${ref("eventi_grezzi")}
${isEleven ? 'where event_date > (select max(event_date) from ${self()})' : ''}
group by event_date
\`\`\`

${isEleven ? '```javascript\nconst soglia = 1000;\nmodule.exports = { soglia };\n```\n' : ''}
![Schema del capitolo ${number}](../assets/figura-${number}.png)
${isEleven ? '\n[IMMAGINE: DAG delle dipendenze per le tabelle incrementali]\n' : ''}
Approfondimento nella [documentazione ufficiale](https://cloud.google.com/dataform/docs).

## Riepilogo

Hai visto ${title.toLowerCase()}.
`;
}

function appendixBody(letter: string, title: string): string {
  return `# Appendice ${letter} — ${title}

Contenuto sintetico dell'appendice ${letter}.

\`\`\`sql
select 1 as esempio;
\`\`\`
`;
}

const APPENDIX_TITLES: Record<string, string> = {
  a: 'Glossario',
  b: 'Riferimenti SQLX',
  c: 'Errori frequenti',
  d: 'Comandi CLI',
  e: 'Tipi BigQuery',
  f: 'Convenzioni di denominazione',
  g: 'Checklist di rilascio',
  h: 'Configurazioni di esempio',
  i: 'Risorse esterne',
  j: 'Indice analitico',
};

const PARTS: { dir: string; title: string; chapters: number[] }[] = [
  { dir: '01-fondamenti', title: 'Fondamenti', chapters: [1, 2, 3, 4, 5, 6, 7] },
  { dir: '02-modellazione', title: 'Modellazione', chapters: [8, 9, 10, 11, 12, 13, 14, 15] },
  { dir: '03-produzione', title: 'Produzione', chapters: [16, 17, 18, 19, 20, 21, 22] },
  { dir: '04-avanzato', title: 'Argomenti avanzati', chapters: [23, 24, 25, 26, 27, 28, 29, 30] },
];

export interface FixtureOptions {
  /** Introduce un capitolo citato dall'indice ma assente dall'archivio. */
  withBrokenIndexReference?: boolean;
  /** Omette il file dell'immagine citata dal capitolo 11. */
  withMissingFigure?: boolean;
}

export function buildDataformFixture(options: FixtureOptions = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {};

  const indexLines: string[] = [
    '---',
    'title: Dataform in Pratica',
    'subtitle: Dalla prima pipeline alla produzione',
    'author: Daniel Meloni',
    'volume: Volume 1',
    '---',
    '',
    '# Dataform in Pratica',
    '',
    '## Indice',
    '',
  ];

  for (const part of PARTS) {
    indexLines.push(`### ${part.title}`, '');
    for (const number of part.chapters) {
      const title = CHAPTER_TITLES[number] ?? `Argomento ${number}`;
      const slug = title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const path = `${part.dir}/capitolo-${String(number).padStart(2, '0')}-${slug}.md`;

      entries[path] = strToU8(chapterBody(number, title));
      indexLines.push(`- [Capitolo ${number} — ${title}](${path})`);
    }
    indexLines.push('');
  }

  indexLines.push('### Appendici', '');
  for (const [letter, title] of Object.entries(APPENDIX_TITLES)) {
    const path = `05-appendici/appendice-${letter}-${title.toLowerCase().replace(/\s+/g, '-')}.md`;
    entries[path] = strToU8(appendixBody(letter.toUpperCase(), title));
    indexLines.push(`- [Appendice ${letter.toUpperCase()} — ${title}](${path})`);
  }

  if (options.withBrokenIndexReference) {
    indexLines.push('- [Capitolo 99 — Mai scritto](01-fondamenti/capitolo-99-fantasma.md)');
  }

  entries['README.md'] = strToU8(`${indexLines.join('\n')}\n`);

  // Immagini citate dai capitoli (PNG minimo valido).
  const pngHeader = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  for (let number = 1; number <= 30; number += 1) {
    if (options.withMissingFigure && number === 11) continue;
    entries[`assets/figura-${number}.png`] = pngHeader;
  }

  // Materiale di contorno, come nell'archivio reale.
  entries['scripts/build_pdf.py'] = strToU8('# script di build\nprint("compilazione")\n');
  entries['scripts/genera_indice.js'] = strToU8('console.log("indice");\n');
  entries['latex/preambolo.tex'] = strToU8('\\documentclass{book}\n');
  entries['dataform.json'] = strToU8('{"warehouse":"bigquery","defaultSchema":"analytics"}\n');
  entries['definitions/eventi_grezzi.sqlx'] = strToU8(
    'config { type: "declaration" }\nselect * from `progetto.dataset.eventi`\n',
  );
  entries['pdf/edizione-precedente.pdf'] = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  entries['copertine/fronte.png'] = pngHeader;

  // Rumore che l'importatore deve ignorare in silenzio.
  entries['__MACOSX/._README.md'] = strToU8('rumore');
  entries['.DS_Store'] = strToU8('rumore');
  entries['01-fondamenti/.gitkeep'] = strToU8('');
  entries['bozze/appunti.docx~'] = strToU8('bozza');

  return zipSync(entries, { level: 6 });
}

/** Archivio con un percorso costruito per uscire dalla cartella di destinazione. */
export function buildZipSlipFixture(): Uint8Array {
  return zipSync({
    'legittimo.md': strToU8('# File legittimo\n'),
    '../../../etc/passwd': strToU8('root:x:0:0\n'),
    '/etc/cron.d/backdoor': strToU8('* * * * * root sh\n'),
    'C:\\Windows\\System32\\config.txt': strToU8('windows\n'),
    'a/b/../../../fuori.md': strToU8('# fuori\n'),
  });
}
