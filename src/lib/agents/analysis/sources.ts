/**
 * Valutazione dei riferimenti citati.
 *
 * «Ufficiale» significa: dominio del produttore della tecnologia trattata.
 * Un blog o una risposta su un forum possono essere utili, ma non sostituiscono
 * la documentazione quando l'affermazione riguarda il comportamento del prodotto.
 */

const OFFICIAL_DOMAINS = [
  'cloud.google.com',
  'dataform.co',
  'docs.dataform.co',
  'developers.google.com',
  'github.com/dataform-co',
  'googleapis.dev',
  'cloud.google.com/bigquery',
];

/** Domini noti per contenuti utili ma non autorevoli in senso stretto. */
const COMMUNITY_DOMAINS = [
  'stackoverflow.com',
  'medium.com',
  'reddit.com',
  'dev.to',
  'towardsdatascience.com',
];

export interface CitationAssessment {
  url: string;
  line: number;
  text: string;
  isOfficial: boolean;
  domain: string;
  note: string | null;
}

export function assessCitation(
  link: { url: string; text: string; line: number },
): CitationAssessment {
  let domain = '';
  let note: string | null = null;

  try {
    const parsed = new URL(link.url);
    domain = parsed.hostname.replace(/^www\./, '');

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
    };
  }

  const path = `${domain}${new URL(link.url).pathname}`;
  const isOfficial = OFFICIAL_DOMAINS.some(
    (official) => domain === official || domain.endsWith(`.${official}`) || path.startsWith(official),
  );

  if (!isOfficial && COMMUNITY_DOMAINS.some((c) => domain === c || domain.endsWith(`.${c}`))) {
    note = note ?? 'Fonte della comunità: utile, ma non sostituisce la documentazione ufficiale.';
  } else if (!isOfficial) {
    note = note ?? 'Dominio non riconosciuto fra le fonti ufficiali del prodotto.';
  }

  return { url: link.url, line: link.line, text: link.text, isOfficial, domain, note };
}
