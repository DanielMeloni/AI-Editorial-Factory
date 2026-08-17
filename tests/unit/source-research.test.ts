import { describe, expect, it } from 'vitest';
import {
  CATALOG_ENTRIES,
  canonicalUrl,
  catalogSize,
  isCommunityDomain,
  isOfficialDomain,
  lookupUrl,
} from '@/lib/sources/catalog';
import { DEFAULT_MIN_SCORE, findSources, tokenize } from '@/lib/sources/match';
import { assessCitation } from '@/lib/agents/analysis/sources';
import { sourceAuditorAgent } from '@/lib/agents/definitions';
import { analyzeMarkdown } from '@/lib/ingest/markdown';
import type { ChapterInput, VerifiableClaim } from '@/lib/agents/schemas';

/**
 * La ricerca automatica delle fonti si regge su una promessa: ciò che viene
 * proposto esiste, perché è stato censito. Questi test verificano la promessa,
 * non l'implementazione: l'indice è chiuso, la ricerca è ripetibile e il
 * silenzio è un esito legittimo.
 */

// ---------------------------------------------------------------------------
// L'indice
// ---------------------------------------------------------------------------

describe('indice delle fonti ufficiali', () => {
  it('contiene soltanto URL cifrati su domini del produttore', () => {
    for (const entry of CATALOG_ENTRIES) {
      expect(entry.url.startsWith('https://')).toBe(true);
      const { hostname, pathname } = new URL(entry.url);
      expect(isOfficialDomain(hostname, pathname)).toBe(true);
    }
  });

  it('non contiene doppioni', () => {
    const canoniche = CATALOG_ENTRIES.map((entry) => canonicalUrl(entry.url));
    expect(new Set(canoniche).size).toBe(CATALOG_ENTRIES.length);
  });

  it('descrive ogni pagina con termini sufficienti a riconoscerla', () => {
    for (const entry of CATALOG_ENTRIES) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.topics.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('riconosce una pagina censita e ignora una che non lo è', () => {
    expect(lookupUrl('https://docs.cloud.google.com/dataform/docs/create-tables')).not.toBeNull();
    expect(lookupUrl('https://docs.cloud.google.com/dataform/docs/pagina-inventata')).toBeNull();
    expect(catalogSize()).toBeGreaterThan(0);
  });

  it('considera equivalenti due forme dello stesso indirizzo', () => {
    const a = canonicalUrl('https://docs.cloud.google.com/dataform/docs/create-tables/');
    const b = canonicalUrl('https://www.docs.cloud.google.com/dataform/docs/create-tables#incremental');
    expect(a).toBe(b);
  });

  it('distingue le fonti della comunità da quelle ufficiali', () => {
    expect(isCommunityDomain('medium.com')).toBe(true);
    expect(isOfficialDomain('medium.com')).toBe(false);
    expect(isOfficialDomain('docs.cloud.google.com')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Il riconoscimento
// ---------------------------------------------------------------------------

describe('ricerca delle fonti', () => {
  it('trova la pagina giusta per un’affermazione italiana', () => {
    const risultati = findSources(
      'Le tabelle incrementali riducono i costi di elaborazione del 90% rispetto a una ricostruzione completa.',
      { category: 'prestazioni' },
    );

    expect(risultati.length).toBeGreaterThan(0);
    expect(risultati[0]!.url).toBe('https://docs.cloud.google.com/dataform/docs/create-tables');
  });

  it('collega un’affermazione sui costi alla pagina sui costi', () => {
    const risultati = findSources('BigQuery addebita i byte scansionati dalla query.', {
      category: 'costo',
    });
    expect(risultati[0]!.url).toBe('https://docs.cloud.google.com/bigquery/docs/best-practices-costs');
  });

  it('collega un’affermazione sui limiti alla pagina delle quote', () => {
    const risultati = findSources('Dataform non supporta più di 1000 azioni per compilazione.', {
      category: 'limite',
    });
    expect(risultati[0]!.url).toBe('https://docs.cloud.google.com/dataform/docs/quotas');
  });

  it('tace quando l’argomento non è nell’indice', () => {
    expect(
      findSources('Il gatto di casa dorme sul divano tutto il pomeriggio senza mai muoversi.'),
    ).toEqual([]);
    expect(findSources('')).toEqual([]);
  });

  it('non propone nulla su una sola parola in comune', () => {
    // «organizzare» compare in una pagina sola: da solo non basta a chiamarla
    // pertinente, e la frase non parla di quella pagina.
    const risultati = findSources(
      'In questo capitolo vedremo come organizzare il lavoro editoriale del volume.',
    );
    expect(risultati).toEqual([]);
  });

  it('propone soltanto URL presenti nell’indice', () => {
    const frasi = [
      'Il partizionamento riduce i costi di scansione.',
      'Le asserzioni verificano la qualità dei dati.',
      'La sintassi ref() dichiara una dipendenza.',
      'Le viste materializzate si aggiornano automaticamente.',
    ];

    for (const frase of frasi) {
      for (const candidato of findSources(frase)) {
        expect(candidato.origin).toBe('catalogo_ufficiale');
        expect(candidato.url).not.toBeNull();
        expect(lookupUrl(candidato.url!)).not.toBeNull();
      }
    }
  });

  it('è stabile: stessa frase, stessi risultati nello stesso ordine', () => {
    const frase = 'Il clustering migliora le prestazioni dei filtri sulle colonne ordinate.';
    expect(findSources(frase)).toEqual(findSources(frase));
  });

  it('rispetta la soglia e il numero massimo di candidati', () => {
    const risultati = findSources('Il partizionamento riduce i costi di scansione in BigQuery.', {
      limit: 2,
    });
    expect(risultati.length).toBeLessThanOrEqual(2);
    expect(risultati.every((r) => r.score >= DEFAULT_MIN_SCORE)).toBe(true);
  });

  it('dichiara i termini che hanno prodotto l’aggancio', () => {
    const risultati = findSources('Il partizionamento riduce i costi di scansione.', {
      category: 'costo',
    });
    expect(risultati[0]!.matchedTerms.length).toBeGreaterThanOrEqual(2);
  });

  it('riconduce le forme italiane e inglesi allo stesso termine', () => {
    expect(tokenize('tabelle incrementali').sort()).toEqual(tokenize('incremental tables').sort());
    expect(tokenize('partizionamento')).toEqual(tokenize('partitioning'));
    expect(tokenize('qualità')).toEqual(tokenize('qualita'));
  });
});

// ---------------------------------------------------------------------------
// La verifica dei riferimenti già presenti
// ---------------------------------------------------------------------------

describe('verifica dei riferimenti citati', () => {
  it('riconosce una pagina ufficiale presente nell’indice', () => {
    const esito = assessCitation({
      url: 'https://docs.cloud.google.com/dataform/docs/create-tables',
      text: 'Creare tabelle',
      line: 10,
    });
    expect(esito.verification).toBe('ufficiale_indicizzata');
    expect(esito.inIndex).toBe(true);
    expect(esito.note).toBeNull();
  });

  it('segnala una pagina ufficiale che l’indice non conosce', () => {
    const esito = assessCitation({
      url: 'https://cloud.google.com/dataform/docs/incremental-tables',
      text: 'documentazione',
      line: 10,
    });
    expect(esito.isOfficial).toBe(true);
    expect(esito.verification).toBe('ufficiale_non_indicizzata');
    expect(esito.note).toMatch(/verificare/i);
  });

  it('riconosce una fonte della comunità e una non interpretabile', () => {
    expect(assessCitation({ url: 'https://medium.com/x', text: 'guida', line: 1 }).verification)
      .toBe('comunita');
    expect(assessCitation({ url: 'non-un-url', text: 'x', line: 1 }).verification)
      .toBe('non_valida');
  });
});

// ---------------------------------------------------------------------------
// L'agente
// ---------------------------------------------------------------------------

const CAPITOLO = `# Costi delle tabelle incrementali

Le tabelle incrementali riducono i costi di elaborazione del 90% rispetto a una
ricostruzione completa del modello.

Il tenore di umidità del legno di rovere stagionato non è mai inferiore a 12%.
`;

function toInput(markdown: string): ChapterInput {
  const analisi = analyzeMarkdown(markdown);
  return {
    chapterId: '11111111-2222-3333-4444-555555555555',
    number: 1,
    title: 'Costi',
    contentMd: markdown,
    headings: analisi.headings.map((h) => ({ level: h.level, text: h.text, line: h.line })),
    codeBlocks: analisi.codeBlocks.map((b) => ({ language: b.language, content: b.content, line: b.line })),
    links: analisi.links,
    figures: analisi.figures.map((f) => ({ alt: f.alt, src: f.src, line: f.line })),
    placeholders: analisi.placeholders.map((p) => ({ description: p.description, line: p.line })),
  };
}

describe('Source Auditor · ricerca automatica', () => {
  const input = toInput(CAPITOLO);

  const claims: VerifiableClaim[] = [
    {
      statement:
        'Le tabelle incrementali riducono i costi di elaborazione del 90% rispetto a una ricostruzione completa del modello.',
      line: 3,
      hasSupportingSource: false,
      category: 'prestazioni',
    },
    {
      statement: 'Il tenore di umidità del legno di rovere stagionato non è mai inferiore a 12%.',
      line: 6,
      hasSupportingSource: false,
      category: 'comportamento',
    },
  ];

  const output = sourceAuditorAgent.deterministic!({ ...input, claims });

  it('produce un output conforme al proprio contratto', () => {
    expect(sourceAuditorAgent.outputSchema.safeParse(output).success).toBe(true);
  });

  it('propone una fonte ufficiale per l’affermazione tecnica', () => {
    const proposta = output.suggestions.find((s) => s.line === 3);
    expect(proposta).toBeDefined();
    expect(proposta!.candidates.length).toBeGreaterThan(0);
    expect(proposta!.candidates[0]!.url).toContain('docs.cloud.google.com');
  });

  it('dichiara l’affermazione per cui l’indice non ha nulla, invece di inventare', () => {
    expect(output.suggestions.some((s) => s.line === 6)).toBe(false);
    expect(output.unmatchedClaims).toBe(1);
    expect(output.summary).toMatch(/pertinente/);
  });

  it('porta ogni proposta fra i rilievi, con l’URL da valutare', () => {
    const rilievo = output.issues.find((i) => i.title === 'Fonte ufficiale proposta');
    expect(rilievo).toBeDefined();
    expect(rilievo!.severity).toBe('info');
    expect(rilievo!.suggestion).toContain('https://');
    expect(rilievo!.evidence.length).toBeGreaterThan(0);
  });

  it('non cerca nulla per le affermazioni che una fonte già ce l’hanno', () => {
    const conFonte = sourceAuditorAgent.deterministic!({
      ...input,
      claims: claims.map((claim) => ({ ...claim, hasSupportingSource: true })),
    });
    expect(conFonte.suggestions).toEqual([]);
    expect(conFonte.unmatchedClaims).toBe(0);
  });
});
