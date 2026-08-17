import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Allineamento dell'indice curato delle fonti ufficiali.
 *
 * Legge le sitemap della documentazione ufficiale, tiene soltanto gli indirizzi
 * sotto i prefissi ammessi e li confronta con `src/lib/sources/catalog.data.ts`.
 *
 * Che cosa fa, e che cosa non fa:
 *  - **segnala** le pagine nuove e quelle che non risultano più pubblicate;
 *  - con `--write` **aggiunge** le nuove in coda al file, con i termini dedotti
 *    dallo slug e marcate da rivedere;
 *  - **non tocca mai** i `topics` già scritti a mano, e **non rimuove** nulla.
 *
 * La rimozione resta una decisione umana: una pagina sparita da una sitemap può
 * essere stata spostata, e cancellarla dall'indice significherebbe perdere la
 * capacità di riconoscere un collegamento ormai morto.
 *
 *   node scripts/refresh-source-catalog.mjs            # solo rapporto
 *   node scripts/refresh-source-catalog.mjs --write     # aggiunge le nuove
 */

const DATA_FILE = join(process.cwd(), 'src', 'lib', 'sources', 'catalog.data.ts');

/** Sitemap da interrogare. Sono indici: contengono altre sitemap. */
const SITEMAPS = [
  'https://docs.cloud.google.com/sitemap.xml',
  'https://cloud.google.com/sitemap.xml',
];

/**
 * Prefissi ammessi. Devono restare allineati a `INDEXABLE_PREFIXES` in
 * `src/lib/sources/catalog.ts`: delimitano la documentazione di Dataform e
 * BigQuery, non l'intero Google Cloud.
 */
const PREFIXES = [
  'docs.cloud.google.com/dataform/',
  'cloud.google.com/dataform/',
  'docs.cloud.google.com/bigquery/',
  'cloud.google.com/bigquery/',
  'docs.dataform.co/',
];

/**
 * Parole che, se compaiono nel NOME di una sitemap annidata, permettono di
 * scaricare solo quella.
 *
 * È una scorciatoia, non un requisito: le sitemap di Google Cloud si chiamano
 * `sitemap_21_of_60.xml` e non nominano il prodotto. Quando nessun nome aiuta,
 * si scaricano tutte e si filtra sul contenuto — che è l'unico modo corretto,
 * e anche il motivo per cui questo script può metterci qualche minuto.
 */
const NESTED_HINTS = ['dataform', 'bigquery'];

/** Limiti di sicurezza: una sitemap ostile non deve poter esaurire la memoria. */
const MAX_URLS = 20_000;
const MAX_NESTED = 80;
const TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------

const write = process.argv.includes('--write');

function canonical(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return null;
  }
}

function isIndexable(url) {
  const key = canonical(url);
  return key !== null && PREFIXES.some((prefix) => key.startsWith(prefix));
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'ai-editorial-factory/source-catalog' },
    });
    if (!response.ok) {
      console.warn(`  ! ${url} ha risposto ${response.status}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.warn(`  ! ${url} non raggiungibile: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Estrae i <loc> di una sitemap. Il formato è semplice: basta questo. */
function extractLocations(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]);
}

/**
 * Quali sitemap annidate scaricare.
 *
 * Se qualche nome nomina il prodotto, bastano quelle. Altrimenti servono tutte:
 * un nome che non dice nulla non autorizza a concludere che il contenuto non
 * interessi. Era esattamente l'errore che rendeva muto questo script.
 */
export function pickChildSitemaps(locations) {
  const mirate = locations.filter((loc) => NESTED_HINTS.some((hint) => loc.includes(hint)));
  return mirate.length > 0 ? mirate : locations;
}

/** Termini dedotti dallo slug: un punto di partenza, non una curatela. */
function topicsFromUrl(url) {
  const slug = new URL(url).pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .pop();

  return [...new Set(slug.split('-').filter((token) => token.length >= 3))];
}

function productOf(url) {
  return canonical(url).includes('/bigquery/') ? 'bigquery' : 'dataform';
}

function titleFromUrl(url) {
  const slug = topicsFromUrl(url).join(' ');
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

// ---------------------------------------------------------------------------
// Raccolta
// ---------------------------------------------------------------------------

async function collectPublishedUrls() {
  const found = new Set();
  const stato = { sitemapLette: 0, urlEsaminati: 0, sitemapFallite: 0 };
  let nested = 0;

  for (const sitemap of SITEMAPS) {
    console.log(`· ${sitemap}`);
    const xml = await fetchText(sitemap);
    if (xml === null) {
      stato.sitemapFallite += 1;
      continue;
    }
    stato.sitemapLette += 1;

    const locations = extractLocations(xml);
    const isIndex = /<sitemapindex/i.test(xml);

    if (!isIndex) {
      for (const location of locations) {
        stato.urlEsaminati += 1;
        if (isIndexable(location)) found.add(location);
        if (found.size >= MAX_URLS) return { found, stato };
      }
      continue;
    }

    const figlie = pickChildSitemaps(locations);
    console.log(`  ${figlie.length} sitemap annidate da leggere (su ${locations.length}).`);

    for (const child of figlie) {
      if (nested >= MAX_NESTED) {
        console.log(`  ! limite di ${MAX_NESTED} sitemap raggiunto: le restanti non sono state lette.`);
        break;
      }

      nested += 1;
      const childXml = await fetchText(child);
      if (childXml === null) {
        stato.sitemapFallite += 1;
        continue;
      }
      stato.sitemapLette += 1;

      let pertinenti = 0;
      for (const location of extractLocations(childXml)) {
        stato.urlEsaminati += 1;
        if (isIndexable(location)) {
          found.add(location);
          pertinenti += 1;
        }
        if (found.size >= MAX_URLS) return { found, stato };
      }

      // Si stampa solo ciò che ha prodotto qualcosa: sessanta righe «0 pagine»
      // sono rumore che nasconde le righe utili.
      if (pertinenti > 0) {
        console.log(`  · ${child.split('/').pop()}: ${pertinenti} pagine pertinenti`);
      }
    }
  }

  return { found, stato };
}

// ---------------------------------------------------------------------------
// Confronto e scrittura
// ---------------------------------------------------------------------------

function renderEntry(url) {
  const topics = topicsFromUrl(url)
    .map((topic) => `'${topic}'`)
    .join(', ');

  return [
    '  {',
    `    url: '${url}',`,
    `    title: '${titleFromUrl(url).replace(/'/g, "\\'")}',`,
    `    product: '${productOf(url)}',`,
    "    section: 'Da rivedere',",
    '    // TODO: rivedere titolo, sezione e termini — dedotti dallo slug.',
    `    topics: [${topics}],`,
    '  },',
  ].join('\n');
}

async function main() {
  const source = await readFile(DATA_FILE, 'utf8');
  const indexed = new Map();
  for (const match of source.matchAll(/url:\s*'([^']+)'/g)) {
    indexed.set(canonical(match[1]), match[1]);
  }

  console.log(`Indice attuale: ${indexed.size} pagine.\n`);
  const { found: published, stato } = await collectPublishedUrls();

  console.log(
    `\nSitemap lette: ${stato.sitemapLette}` +
      (stato.sitemapFallite > 0 ? `, non raggiungibili: ${stato.sitemapFallite}` : '') +
      `. Indirizzi esaminati: ${stato.urlEsaminati}.`,
  );

  if (published.size === 0) {
    // Due esiti diversi meritano due messaggi diversi: «non ho potuto leggere»
    // non è «ho letto e non c'era nulla».
    console.error(
      stato.sitemapLette === 0
        ? '\nNessuna sitemap raggiungibile: verifica la connessione. Indice invariato.'
        : `\nNessuno dei ${stato.urlEsaminati} indirizzi letti ricade sotto i prefissi ammessi ` +
            `(${PREFIXES.join(', ')}). Indice invariato.`,
    );
    process.exitCode = 1;
    return;
  }

  const publishedKeys = new Map();
  for (const url of published) publishedKeys.set(canonical(url), url);

  const nuove = [...publishedKeys].filter(([key]) => !indexed.has(key)).map(([, url]) => url).sort();
  const sparite = [...indexed].filter(([key]) => !publishedKeys.has(key)).map(([, url]) => url).sort();

  console.log(`\nPagine pubblicate sotto i prefissi ammessi: ${published.size}`);
  console.log(`Nuove rispetto all’indice: ${nuove.length}`);
  console.log(`Nell’indice ma non più pubblicate: ${sparite.length}`);

  if (sparite.length > 0) {
    console.log('\nDa verificare a mano — potrebbero essere state spostate:');
    for (const url of sparite) console.log(`  - ${url}`);
  }

  if (nuove.length === 0) {
    console.log('\nNulla da aggiungere.');
    return;
  }

  if (!write) {
    console.log('\nPrime venti pagine nuove (riesegui con --write per aggiungerle):');
    for (const url of nuove.slice(0, 20)) console.log(`  + ${url}`);
    return;
  }

  const blocco = [
    '',
    '  // -------------------------------------------------------------------------',
    `  // Aggiunte automatiche del ${new Date().toISOString().slice(0, 10)} — termini da rivedere`,
    '  // -------------------------------------------------------------------------',
    ...nuove.map(renderEntry),
  ].join('\n');

  const chiusura = source.lastIndexOf('];');
  if (chiusura === -1) {
    console.error('Formato inatteso: non trovo la chiusura dell’elenco. Indice invariato.');
    process.exitCode = 1;
    return;
  }

  const aggiornato =
    source.slice(0, chiusura) +
    blocco +
    '\n' +
    source.slice(chiusura);

  await writeFile(
    DATA_FILE,
    aggiornato.replace(
      /export const CATALOG_GENERATED_AT = '[^']*';/,
      `export const CATALOG_GENERATED_AT = '${new Date().toISOString().slice(0, 10)}';`,
    ),
    'utf8',
  );

  console.log(`\n${nuove.length} pagine aggiunte a catalog.data.ts.`);
  console.log('Rivedi titoli, sezioni e termini prima di committare: i topics dedotti');
  console.log('dallo slug sono in inglese, e il manuale è in italiano.');
}

// Eseguito come script, non quando viene importato da un test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
