/**
 * Valutazione dei riferimenti citati.
 *
 * «Ufficiale» significa: dominio del produttore della tecnologia trattata.
 * Un blog o una risposta su un forum possono essere utili, ma non sostituiscono
 * la documentazione quando l'affermazione riguarda il comportamento del prodotto.
 *
 * Al giudizio sul dominio si aggiunge il confronto con l'indice curato: un URL
 * sul dominio giusto ma che l'indice non conosce merita un controllo — la
 * documentazione viene riorganizzata di continuo, e un collegamento morto è
 * peggio di un collegamento assente.
 */

import { isCommunityDomain, isOfficialDomain, lookupUrl } from '@/lib/sources/catalog';

/**
 * Esito del confronto con l'indice ufficiale.
 *
 *  - `ufficiale_indicizzata`     dominio del produttore, pagina presente nell'indice
 *  - `ufficiale_non_indicizzata` dominio del produttore, pagina non censita
 *  - `comunita`                  fonte utile ma non autorevole
 *  - `sconosciuta`               dominio non riconosciuto
 *  - `non_valida`                URL non interpretabile
 */
export type CitationVerification =
  | 'ufficiale_indicizzata'
  | 'ufficiale_non_indicizzata'
  | 'comunita'
  | 'sconosciuta'
  | 'non_valida';

export interface CitationAssessment {
  url: string;
  line: number;
  text: string;
  isOfficial: boolean;
  domain: string;
  note: string | null;
  /** Vero se la pagina è presente nell'indice curato delle fonti ufficiali. */
  inIndex: boolean;
  verification: CitationVerification;
  /** Titolo della pagina secondo l'indice, quando disponibile. */
  indexedTitle: string | null;
}

export function assessCitation(
  link: { url: string; text: string; line: number },
): CitationAssessment {
  let domain = '';
  let pathname = '/';
  let note: string | null = null;

  try {
    const parsed = new URL(link.url);
    domain = parsed.hostname.replace(/^www\./, '');
    pathname = parsed.pathname;

    if (parsed.protocol !== 'https:') {
      note = 'Collegamento non cifrato (http): preferire https.';
    }
  } catch {
    return {
      url: link.url,
      line: link.line,
      text: link.text,
      isOfficial: false,
      domain: '',
      note: 'URL non interpretabile.',
      inIndex: false,
      verification: 'non_valida',
      indexedTitle: null,
    };
  }

  const isOfficial = isOfficialDomain(domain, pathname);
  const indexed = lookupUrl(link.url);

  let verification: CitationVerification;
  if (isOfficial) {
    verification = indexed ? 'ufficiale_indicizzata' : 'ufficiale_non_indicizzata';
  } else if (isCommunityDomain(domain)) {
    verification = 'comunita';
  } else {
    verification = 'sconosciuta';
  }

  if (verification === 'ufficiale_non_indicizzata') {
    note =
      note ??
      'Dominio ufficiale, ma la pagina non risulta nell’indice curato: verificare ' +
        'che il collegamento sia ancora valido.';
  } else if (verification === 'comunita') {
    note = note ?? 'Fonte della comunità: utile, ma non sostituisce la documentazione ufficiale.';
  } else if (verification === 'sconosciuta') {
    note = note ?? 'Dominio non riconosciuto fra le fonti ufficiali del prodotto.';
  }

  return {
    url: link.url,
    line: link.line,
    text: link.text,
    isOfficial,
    domain,
    note,
    inIndex: indexed !== null,
    verification,
    indexedTitle: indexed?.title ?? null,
  };
}
