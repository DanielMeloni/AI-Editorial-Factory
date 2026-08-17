/**
 * Indice curato delle fonti ufficiali.
 *
 * La ricerca automatica delle fonti non interroga il web aperto: interroga
 * questo indice. È una scelta, non un limite tecnico.
 *
 *  - **Nessuna allucinazione possibile.** Una fonte proposta esiste perché è
 *    stata censita qui, non perché un modello l'ha scritta in modo plausibile.
 *  - **Deterministica.** Stesso capitolo, stesso indice, stesse proposte: il
 *    risultato è riproducibile e verificabile in un test.
 *  - **Ufficiale per costruzione.** Nell'indice entrano soltanto pagine sui
 *    domini del produttore. Non serve valutare l'autorevolezza a posteriori.
 *
 * Il prezzo è la copertura: ciò che non è nell'indice non viene proposto, e il
 * sistema lo dichiara invece di ripiegare su una fonte qualsiasi.
 *
 * L'indice si aggiorna con `npm run sources:refresh`, che legge le sitemap
 * ufficiali limitatamente ai prefissi ammessi e riscrive `catalog.data.ts`.
 */

import { CATALOG_ENTRIES, CATALOG_GENERATED_AT } from './catalog.data';

// ---------------------------------------------------------------------------
// Domini
// ---------------------------------------------------------------------------

/**
 * Domini del produttore della tecnologia trattata.
 *
 * «Ufficiale» significa questo e solo questo. Un blog o una risposta su un forum
 * possono essere utili, ma non sostituiscono la documentazione quando
 * l'affermazione riguarda il comportamento del prodotto.
 */
export const OFFICIAL_DOMAINS = [
  'cloud.google.com',
  'docs.cloud.google.com',
  'dataform.co',
  'docs.dataform.co',
  'developers.google.com',
  'github.com/dataform-co',
  'googleapis.dev',
] as const;

/** Domini noti per contenuti utili ma non autorevoli in senso stretto. */
export const COMMUNITY_DOMAINS = [
  'stackoverflow.com',
  'medium.com',
  'reddit.com',
  'dev.to',
  'towardsdatascience.com',
] as const;

/**
 * Prefissi ammessi nell'indice.
 *
 * Delimitano che cosa lo script di aggiornamento può raccogliere: la
 * documentazione di Dataform e BigQuery, non l'intero Google Cloud.
 */
export const INDEXABLE_PREFIXES = [
  'docs.cloud.google.com/dataform/',
  'cloud.google.com/dataform/',
  'docs.cloud.google.com/bigquery/',
  'cloud.google.com/bigquery/',
  'docs.dataform.co/',
] as const;

export type CatalogProduct = 'dataform' | 'bigquery';

export interface CatalogEntry {
  /** URL assoluto e cifrato della pagina ufficiale. */
  url: string;
  title: string;
  product: CatalogProduct;
  /** Sezione della documentazione, utile a spiegare la proposta al revisore. */
  section: string;
  /**
   * Termini che descrivono la pagina, in italiano e in inglese.
   * Sono la chiave del riconoscimento: il testo del manuale è in italiano, la
   * documentazione in inglese, e l'aggancio avviene qui.
   */
  topics: string[];
}

export { CATALOG_ENTRIES, CATALOG_GENERATED_AT };

// ---------------------------------------------------------------------------
// Interrogazione
// ---------------------------------------------------------------------------

/** Vero se il dominio appartiene al produttore della tecnologia trattata. */
export function isOfficialDomain(domain: string, pathname = '/'): boolean {
  const normalized = domain.replace(/^www\./, '');
  const withPath = `${normalized}${pathname}`;
  return OFFICIAL_DOMAINS.some(
    (official) =>
      normalized === official ||
      normalized.endsWith(`.${official}`) ||
      withPath.startsWith(official),
  );
}

/** Vero se il dominio è fra quelli della comunità: utili, non autorevoli. */
export function isCommunityDomain(domain: string): boolean {
  const normalized = domain.replace(/^www\./, '');
  return COMMUNITY_DOMAINS.some(
    (community) => normalized === community || normalized.endsWith(`.${community}`),
  );
}

/**
 * Forma canonica di un URL, per confrontare due riferimenti alla stessa pagina.
 * Frammento e parametri di tracciamento non cambiano la pagina citata; lo
 * schema e il `www.` iniziale nemmeno.
 */
export function canonicalUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return null;
  }
}

const BY_CANONICAL: ReadonlyMap<string, CatalogEntry> = new Map(
  CATALOG_ENTRIES.flatMap((entry) => {
    const key = canonicalUrl(entry.url);
    return key === null ? [] : [[key, entry] as const];
  }),
);

/**
 * Cerca nell'indice la pagina corrispondente a un URL citato.
 * Serve a distinguere «fonte ufficiale che sappiamo esistere» da «dominio
 * giusto, pagina che non risulta»: la seconda merita un controllo.
 */
export function lookupUrl(url: string): CatalogEntry | null {
  const key = canonicalUrl(url);
  return key === null ? null : (BY_CANONICAL.get(key) ?? null);
}

/** Numero di pagine censite. Usato nei riepiloghi e nella diagnostica. */
export function catalogSize(): number {
  return CATALOG_ENTRIES.length;
}
