import 'server-only';

import { htmlToText } from './extract';
import { isCommunityDomain, isOfficialDomain } from './catalog';

/**
 * Verifica che un indirizzo esista davvero.
 *
 * È il punto su cui regge tutta la ricerca web. Un modello che cerca sul web
 * può riferire un URL plausibile e inesistente — è il modo tipico in cui una
 * ricerca automatica produce danno in un manuale tecnico, perché l'errore si
 * scopre mesi dopo, in stampa. Qui l'indirizzo viene **aperto**: se non
 * risponde non viene mostrato, e il titolo che il revisore legge è quello
 * scritto nella pagina, non quello dichiarato da chi l'ha proposta.
 *
 * Non è una garanzia sul contenuto — nessuno può prometterla — ma sposta il
 * confine: fra ciò che esiste e ciò che è utile decide una persona; fra ciò
 * che esiste e ciò che è inventato decide questo controllo.
 */

const TIMEOUT_MS = 12_000;

/** Oltre questa soglia si smette di leggere: serve il titolo, non la pagina intera. */
const MAX_BYTES = 512_000;

export type UrlVerdict =
  | 'raggiungibile'
  | 'non_raggiungibile'
  | 'non_testuale'
  | 'indirizzo_non_valido';

export interface VerifiedUrl {
  /** Indirizzo finale, dopo i reindirizzamenti. */
  url: string;
  /** Indirizzo di partenza, quando il reindirizzamento l'ha cambiato. */
  requestedUrl: string;
  verdict: UrlVerdict;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  /** Titolo letto dalla pagina. Nullo se la pagina non ne dichiara uno. */
  title: string | null;
  /** Prime righe di testo: servono a capire di che parla, e a indicizzare. */
  excerpt: string | null;
  domain: string;
  isOfficial: boolean;
  isCommunity: boolean;
  note: string | null;
}

function refuse(requestedUrl: string, verdict: UrlVerdict, note: string): VerifiedUrl {
  return {
    url: requestedUrl,
    requestedUrl,
    verdict,
    ok: false,
    status: null,
    contentType: null,
    title: null,
    excerpt: null,
    domain: '',
    isOfficial: false,
    isCommunity: false,
    note,
  };
}

/**
 * Apre un indirizzo e riferisce che cosa ha trovato.
 *
 * Non lancia mai: un indirizzo irraggiungibile è un esito, non un guasto del
 * programma. Chi chiama decide se scartarlo o mostrarlo come tale.
 */
export async function verifyUrl(rawUrl: string): Promise<VerifiedUrl> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return refuse(rawUrl, 'indirizzo_non_valido', 'Indirizzo non interpretabile.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return refuse(rawUrl, 'indirizzo_non_valido', `Protocollo non ammesso: ${parsed.protocol}`);
  }

  // Nessuna richiesta verso la rete interna: un indirizzo proposto da un
  // modello non deve poter diventare una sonda sull'infrastruttura.
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '::1' ||
    /^(127|10|169\.254)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return refuse(rawUrl, 'indirizzo_non_valido', 'Indirizzo su rete interna: ignorato.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'ai-editorial-factory/source-verifier',
        accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5',
      },
    });

    const finalUrl = response.url || parsed.toString();
    const finalDomain = new URL(finalUrl).hostname.replace(/^www\./, '');
    const finalPath = new URL(finalUrl).pathname;
    const contentType = response.headers.get('content-type');

    const comune = {
      url: finalUrl,
      requestedUrl: rawUrl,
      status: response.status,
      contentType,
      domain: finalDomain,
      isOfficial: isOfficialDomain(finalDomain, finalPath),
      isCommunity: isCommunityDomain(finalDomain),
    };

    if (!response.ok) {
      return {
        ...comune,
        verdict: 'non_raggiungibile',
        ok: false,
        title: null,
        excerpt: null,
        note: `La pagina ha risposto ${response.status}.`,
      };
    }

    // Un PDF pubblico è una fonte legittima: esiste, ma non se ne legge il
    // titolo qui. Verrà estratto quando la fonte entra nella biblioteca.
    if (contentType?.includes('application/pdf')) {
      return {
        ...comune,
        verdict: 'raggiungibile',
        ok: true,
        title: null,
        excerpt: null,
        note: 'Documento PDF: il testo verrà estratto all’aggiunta in biblioteca.',
      };
    }

    if (contentType !== null && !contentType.includes('html') && !contentType.includes('text/')) {
      return {
        ...comune,
        verdict: 'non_testuale',
        ok: false,
        title: null,
        excerpt: null,
        note: `Contenuto non testuale (${contentType}).`,
      };
    }

    const html = (await response.text()).slice(0, MAX_BYTES);
    const { title, text } = htmlToText(html);

    return {
      ...comune,
      verdict: 'raggiungibile',
      ok: true,
      title,
      excerpt: text.slice(0, 1000) || null,
      note:
        text.length < 200
          ? 'La pagina restituisce pochissimo testo: probabilmente si costruisce nel browser.'
          : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...refuse(rawUrl, 'non_raggiungibile', `Non raggiungibile: ${message}`),
      domain: parsed.hostname.replace(/^www\./, ''),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifica più indirizzi, a piccoli gruppi.
 *
 * Il parallelismo è volutamente basso: una raffica di richieste simultanee
 * verso lo stesso dominio è indistinguibile da un abuso, e il primo a
 * bloccarci sarebbe proprio il sito che vogliamo citare.
 */
export async function verifyUrls(urls: readonly string[], concurrency = 4): Promise<VerifiedUrl[]> {
  const risultati: VerifiedUrl[] = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const gruppo = urls.slice(i, i + concurrency);
    risultati.push(...(await Promise.all(gruppo.map((url) => verifyUrl(url)))));
  }

  return risultati;
}
