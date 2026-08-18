import { describe, expect, it } from 'vitest';
import { sourceDiscoveryAgent } from '@/lib/agents/definitions';
import { buildQueries } from '@/lib/sources/discovery';
import { MockWebSearchProvider } from '@/lib/ai/search/mock';
import type { WebCandidate } from '@/lib/agents/schemas';

/**
 * La ricerca sul web.
 *
 * Aprire il web reintroduce un rischio che l'indice chiuso non aveva: un
 * indirizzo plausibile e inesistente. La difesa non è nel prompt — è nel fatto
 * che ogni indirizzo viene aperto, e che la selezione può solo scegliere fra
 * ciò che ha risposto. Questi test verificano quella difesa.
 */

// ---------------------------------------------------------------------------
// Il motore simulato
// ---------------------------------------------------------------------------

describe('motore di ricerca simulato', () => {
  it('non inventa risultati e lo dichiara', async () => {
    const esito = await new MockWebSearchProvider().search({ query: 'partizionamento BigQuery' });

    expect(esito.hits).toEqual([]);
    expect(esito.estimatedCostUsd).toBe(0);
    expect(esito.warnings.join(' ')).toMatch(/non inventa/i);
  });
});

// ---------------------------------------------------------------------------
// Le interrogazioni
// ---------------------------------------------------------------------------

describe('costruzione delle interrogazioni', () => {
  const base = {
    title: 'Dataform in Pratica',
    subtitle: 'Volume 1',
    topics: ['Incremental Tables', 'Assertions', 'Dipendenze'],
  };

  it('ricava che cosa cercare dal titolo e dagli argomenti', () => {
    const queries = buildQueries(base);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.join(' ')).toContain('Dataform in Pratica');
    expect(queries.join(' ')).toContain('Incremental Tables');
  });

  it('mette per prima l’interrogazione scritta dall’autore', () => {
    const queries = buildQueries({ ...base, extra: 'specifiche sul partizionamento' });
    expect(queries[0]).toBe('specifiche sul partizionamento');
  });

  it('ignora un’interrogazione vuota invece di cercare il nulla', () => {
    expect(buildQueries({ ...base, extra: '   ' })).toEqual(buildQueries(base));
  });

  it('non esplode il numero di ricerche al crescere dei capitoli', () => {
    const molti = Array.from({ length: 60 }, (_, i) => `Capitolo ${i}`);
    // Una ricerca per capitolo darebbe decine di chiamate e un elenco che
    // nessuno leggerebbe.
    expect(buildQueries({ ...base, topics: molti }).length).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// La selezione
// ---------------------------------------------------------------------------

function candidato(over: Partial<WebCandidate>): WebCandidate {
  return {
    url: 'https://esempio.org/pagina',
    title: 'Pagina',
    domain: 'esempio.org',
    isOfficial: false,
    isCommunity: false,
    excerpt: null,
    ...over,
  };
}

const INPUT = {
  projectTitle: 'Dataform in Pratica',
  subtitle: 'Volume 1',
  language: 'it',
  topics: ['Incremental Tables'],
  candidates: [
    candidato({
      url: 'https://docs.cloud.google.com/dataform/docs/create-tables',
      title: 'Create tables',
      domain: 'docs.cloud.google.com',
      isOfficial: true,
    }),
    candidato({
      url: 'https://docs.cloud.google.com/dataform/docs/reference/dataform-core-reference',
      title: 'Dataform core reference',
      domain: 'docs.cloud.google.com',
      isOfficial: true,
    }),
    candidato({
      url: 'https://medium.com/@tizio/dataform-tips',
      title: 'Dataform tips',
      domain: 'medium.com',
      isCommunity: true,
    }),
    candidato({ url: 'https://blog.ignoto.xyz/post', domain: 'blog.ignoto.xyz' }),
  ],
};

describe('selezione delle fonti trovate', () => {
  const output = sourceDiscoveryAgent.deterministic!(INPUT);

  it('produce un output conforme al proprio contratto', () => {
    expect(sourceDiscoveryAgent.outputSchema.safeParse(output).success).toBe(true);
  });

  it('sceglie soltanto fra gli indirizzi ricevuti', () => {
    const ammessi = new Set(INPUT.candidates.map((c) => c.url));
    for (const voce of output.selected) expect(ammessi.has(voce.url)).toBe(true);
  });

  it('tiene la documentazione del produttore', () => {
    expect(output.selected.map((voce) => voce.url)).toContain(
      'https://docs.cloud.google.com/dataform/docs/create-tables',
    );
  });

  it('riconosce un riferimento API come tale', () => {
    const riferimento = output.selected.find((voce) => voce.url.includes('/reference/'));
    expect(riferimento?.kind).toBe('riferimento_api');
  });

  it('scarta comunità e domini sconosciuti, dicendo perché', () => {
    const scartati = output.discarded.map((voce) => voce.url);
    expect(scartati).toContain('https://medium.com/@tizio/dataform-tips');
    expect(scartati).toContain('https://blog.ignoto.xyz/post');
    expect(output.discarded.every((voce) => voce.reason.length > 10)).toBe(true);
  });

  it('non lascia nessun candidato senza esito', () => {
    expect(output.selected.length + output.discarded.length).toBe(INPUT.candidates.length);
  });

  it('motiva ogni scelta', () => {
    expect(output.selected.every((voce) => voce.rationale.length > 10)).toBe(true);
  });

  it('dichiara il proprio limite invece di nasconderlo', () => {
    // Senza modello la pertinenza all'argomento non viene valutata: il
    // riepilogo lo dice, invece di far credere a un giudizio che non c'è.
    expect(output.summary).toMatch(/senza un modello/i);
  });

  it('è stabile: stesso input, stessa selezione', () => {
    expect(sourceDiscoveryAgent.deterministic!(INPUT)).toEqual(output);
  });
});

// ---------------------------------------------------------------------------
// La verifica degli indirizzi
// ---------------------------------------------------------------------------

describe('verifica degli indirizzi', () => {
  it('rifiuta ciò che non è un indirizzo, senza chiamare la rete', async () => {
    const { verifyUrl } = await import('@/lib/sources/verify-url');

    const esito = await verifyUrl('non-un-indirizzo');
    expect(esito.ok).toBe(false);
    expect(esito.verdict).toBe('indirizzo_non_valido');
  });

  it('rifiuta gli schemi diversi da http e https', async () => {
    const { verifyUrl } = await import('@/lib/sources/verify-url');
    expect((await verifyUrl('file:///etc/passwd')).verdict).toBe('indirizzo_non_valido');
  });

  it('non interroga la rete interna', async () => {
    // Un indirizzo proposto da un modello non deve poter diventare una sonda
    // sull'infrastruttura.
    const { verifyUrl } = await import('@/lib/sources/verify-url');

    for (const url of [
      'http://localhost:3000/admin',
      'http://127.0.0.1/',
      'http://192.168.1.1/',
      'http://10.0.0.5/',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      const esito = await verifyUrl(url);
      expect(esito.ok).toBe(false);
      expect(esito.note).toMatch(/interna/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Gli errori del fornitore
// ---------------------------------------------------------------------------

describe('messaggi di errore dell’API', () => {
  it('riporta il motivo scritto dal fornitore, non solo il codice', async () => {
    const { describeApiError } = await import('@/lib/ai/search/anthropic');

    const messaggio = describeApiError(
      400,
      JSON.stringify({
        error: { type: 'invalid_request_error', message: 'something specific went wrong' },
      }),
    );
    expect(messaggio).toContain('something specific went wrong');
  });

  it('riconosce lo strumento non abilitato e dice dove metter mano', async () => {
    const { describeApiError } = await import('@/lib/ai/search/anthropic');

    const messaggio = describeApiError(
      400,
      JSON.stringify({
        error: { message: 'web search is not enabled for this organization' },
      }),
    );
    expect(messaggio).toMatch(/amministratore/i);
    expect(messaggio).toMatch(/console/i);
  });

  it('distingue un modello non valido da un problema di credito', async () => {
    const { describeApiError } = await import('@/lib/ai/search/anthropic');

    expect(
      describeApiError(400, JSON.stringify({ error: { message: 'model: unknown model xyz' } })),
    ).toMatch(/AI_SEARCH_MODEL/);
    expect(
      describeApiError(400, JSON.stringify({ error: { message: 'insufficient credit balance' } })),
    ).toMatch(/credito/i);
  });

  it('non si perde se il corpo non è JSON', async () => {
    const { describeApiError } = await import('@/lib/ai/search/anthropic');

    expect(describeApiError(502, '<html>Bad Gateway</html>')).toContain('502');
    expect(describeApiError(500, '')).toBe('Anthropic ha risposto 500.');
  });
});

// ---------------------------------------------------------------------------
// Il motore OpenAI
// ---------------------------------------------------------------------------

describe('coerenza fra fornitore e modello', () => {
  it('accetta un modello che appartiene al fornitore', async () => {
    const { searchModelFor } = await import('@/lib/ai/registry');

    expect(searchModelFor('openai', 'gpt-5.6')).toEqual({ model: 'gpt-5.6', note: null });
    expect(searchModelFor('anthropic', 'claude-sonnet-5')).toEqual({
      model: 'claude-sonnet-5',
      note: null,
    });
  });

  it('corregge un modello di un altro fornitore, dichiarandolo', async () => {
    const { searchModelFor } = await import('@/lib/ai/registry');

    // Cambiare fornitore dimenticando il modello è una svista frequente, e
    // darebbe un errore oscuro dall'altra parte.
    const esito = searchModelFor('openai', 'claude-sonnet-5');
    expect(esito.model).toBe('gpt-5.6');
    expect(esito.note).toMatch(/non è un modello openai/i);
  });
});

describe('errori dell’API OpenAI', () => {
  it('riconosce quota esaurita e chiave non valida', async () => {
    const { describeOpenAiError } = await import('@/lib/ai/search/openai');

    expect(
      describeOpenAiError(429, JSON.stringify({ error: { message: 'You exceeded your quota' } })),
    ).toMatch(/quota esaurit/i);
    expect(
      describeOpenAiError(401, JSON.stringify({ error: { message: 'Incorrect API key' } })),
    ).toMatch(/OPENAI_API_KEY/);
  });

  it('riporta il messaggio del fornitore anche quando non lo riconosce', async () => {
    const { describeOpenAiError } = await import('@/lib/ai/search/openai');

    expect(
      describeOpenAiError(400, JSON.stringify({ error: { message: 'qualcosa di inatteso' } })),
    ).toContain('qualcosa di inatteso');
  });
});

// ---------------------------------------------------------------------------
// Il motore Gemini
// ---------------------------------------------------------------------------

describe('raccolta degli indirizzi da Gemini', () => {
  it('legge la forma recente, con le annotazioni', async () => {
    const { extractGeminiUrls } = await import('@/lib/ai/search/gemini');

    const risposta = {
      output: [
        {
          type: 'model_output',
          content: [
            {
              type: 'text',
              annotations: [
                { type: 'url_citation', url: 'https://esempio.org/a', title: 'esempio.org' },
                { type: 'url_citation', url: 'https://esempio.org/b', title: 'altro' },
              ],
            },
          ],
        },
      ],
    };

    const hits = extractGeminiUrls(risposta, 10);
    expect(hits.map((h) => h.url)).toEqual(['https://esempio.org/a', 'https://esempio.org/b']);
    expect(hits[0]!.title).toBe('esempio.org');
  });

  it('legge anche la forma precedente, con groundingChunks', async () => {
    const { extractGeminiUrls } = await import('@/lib/ai/search/gemini');

    // Un aggiornamento dell'API non deve rendere muto il motore senza che
    // nessuno se ne accorga: è il modo peggiore di rompersi.
    const risposta = {
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: 'https://vecchia.example/x', title: 'Pagina' } },
            ],
          },
        },
      ],
    };

    expect(extractGeminiUrls(risposta, 10).map((h) => h.url)).toEqual([
      'https://vecchia.example/x',
    ]);
  });

  it('non duplica lo stesso indirizzo e rispetta il limite', async () => {
    const { extractGeminiUrls } = await import('@/lib/ai/search/gemini');

    const risposta = {
      a: [{ type: 'url_citation', url: 'https://x.example/1' }],
      b: [{ type: 'url_citation', url: 'https://x.example/1' }],
      c: [
        { type: 'url_citation', url: 'https://x.example/2' },
        { type: 'url_citation', url: 'https://x.example/3' },
      ],
    };

    expect(extractGeminiUrls(risposta, 10)).toHaveLength(3);
    expect(extractGeminiUrls(risposta, 2)).toHaveLength(2);
  });

  it('non si perde su una risposta vuota o inattesa', async () => {
    const { extractGeminiUrls } = await import('@/lib/ai/search/gemini');

    expect(extractGeminiUrls({}, 10)).toEqual([]);
    expect(extractGeminiUrls(null, 10)).toEqual([]);
    expect(extractGeminiUrls({ output: 'testo semplice' }, 10)).toEqual([]);
  });
});

describe('errori dell’API Gemini', () => {
  it('spiega che la quota gratuita si azzera ogni giorno', async () => {
    const { describeGeminiError } = await import('@/lib/ai/search/gemini');

    expect(
      describeGeminiError(429, JSON.stringify({ error: { message: 'Quota exceeded' } })),
    ).toMatch(/si azzera ogni giorno/i);
  });

  it('distingue una chiave rifiutata da un modello sbagliato', async () => {
    const { describeGeminiError } = await import('@/lib/ai/search/gemini');

    expect(
      describeGeminiError(403, JSON.stringify({ error: { message: 'API key not valid' } })),
    ).toMatch(/GEMINI_API_KEY/);
    expect(
      describeGeminiError(400, JSON.stringify({ error: { message: 'model not found' } })),
    ).toMatch(/AI_SEARCH_MODEL/);
  });

  it('suggerisce il modello con quota gratuita se ne serve uno a pagamento', async () => {
    const { describeGeminiError } = await import('@/lib/ai/search/gemini');

    expect(
      describeGeminiError(400, JSON.stringify({ error: { message: 'billing required' } })),
    ).toMatch(/gemini-2\.5-flash/);
  });
});

describe('coerenza del modello Gemini', () => {
  it('corregge un modello di un altro fornitore', async () => {
    const { searchModelFor } = await import('@/lib/ai/registry');

    expect(searchModelFor('gemini', 'gemini-2.5-flash').note).toBeNull();
    expect(searchModelFor('gemini', 'gpt-5.6').model).toBe('gemini-2.5-flash');
  });
});

// ---------------------------------------------------------------------------
// «Non lo conosco» non è «non esiste»
// ---------------------------------------------------------------------------

describe('sospetto contro verifica', () => {
  it('una pagina ufficiale fuori dall’indice non è un difetto del capitolo', async () => {
    const { lookupUrl, isOfficialDomain } = await import('@/lib/sources/catalog');
    const url = 'https://docs.cloud.google.com/dataform/docs/best-practices-repositories';

    // Questa pagina esiste davvero, ma non è censita: l'indice non è il mondo.
    expect(lookupUrl(url)).toBeNull();
    expect(isOfficialDomain(new URL(url).hostname, new URL(url).pathname)).toBe(true);

    // È il motivo per cui l'audit apre i collegamenti invece di fermarsi a
    // «non risulta»: la seconda domanda ha una risposta, la prima no.
  });
});
