import { describe, expect, it } from 'vitest';
import {
  buildSourceIndex,
  catalogAsEntries,
  searchIndex,
  type SearchableEntry,
} from '@/lib/sources/match';
import {
  addLinkSchema,
  addPdfSchema,
  buildReferenceStoragePath,
  hasPdfSignature,
  referenceEntries,
  sanitizePdfName,
  splitIntoChunks,
} from '@/lib/sources/references';
import { htmlToText } from '@/lib/sources/extract';
import { mergeSuggestions, researchClaims } from '@/lib/sources/research';
import type { ResearchClaim } from '@/lib/sources/research';

/**
 * La biblioteca del progetto: link e PDF aggiunti a mano.
 *
 * La promessa qui è diversa da quella dell'indice ufficiale. Non è «esiste
 * perché è censito» — quello che l'autore carica esiste per definizione — ma
 * «non viene confuso con la documentazione del produttore»: l'origine resta
 * scritta, e il peso rispecchia l'autorevolezza dichiarata.
 */

// ---------------------------------------------------------------------------
// Validazione e archiviazione
// ---------------------------------------------------------------------------

describe('validazione delle fonti aggiunte', () => {
  const projectId = '11111111-2222-4333-8444-555555555555';

  it('accetta un link completo e rifiuta un indirizzo senza schema', () => {
    expect(
      addLinkSchema.safeParse({ projectId, url: 'https://esempio.org/x', title: 'Specifica' })
        .success,
    ).toBe(true);
    expect(addLinkSchema.safeParse({ projectId, url: 'esempio.org', title: 'X' }).success).toBe(
      false,
    );
  });

  it('rifiuta un link senza titolo: un elenco senza titoli è illeggibile', () => {
    expect(
      addLinkSchema.safeParse({ projectId, url: 'https://esempio.org', title: '   ' }).success,
    ).toBe(false);
  });

  it('accetta solo file .pdf entro il limite', () => {
    const base = { projectId, title: 'Norma' };
    expect(addPdfSchema.safeParse({ ...base, filename: 'norma.pdf', byteSize: 1000 }).success).toBe(
      true,
    );
    expect(addPdfSchema.safeParse({ ...base, filename: 'norma.docx', byteSize: 1000 }).success).toBe(
      false,
    );
    expect(
      addPdfSchema.safeParse({ ...base, filename: 'enorme.pdf', byteSize: 999_999_999 }).success,
    ).toBe(false);
  });

  it('non si fida del nome file ricevuto', () => {
    expect(sanitizePdfName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(sanitizePdfName('nòrma spéciale.pdf')).toBe('norma-speciale.pdf');
    expect(
      addPdfSchema.safeParse({
        projectId,
        title: 'X',
        filename: '../fuga.pdf',
        byteSize: 10,
      }).success,
    ).toBe(false);
  });

  it('mette l’organizzazione nel primo segmento del percorso', () => {
    const path = buildReferenceStoragePath('org-1', 'prog-1', 'ref-1', 'documento.pdf');
    expect(path.startsWith('org-1/')).toBe(true);
    expect(path).toContain('/references/ref-1/');
  });

  it('riconosce la firma di un PDF', () => {
    expect(hasPdfSignature(new TextEncoder().encode('%PDF-1.7'))).toBe(true);
    expect(hasPdfSignature(new TextEncoder().encode('PK'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suddivisione del testo
// ---------------------------------------------------------------------------

describe('suddivisione in blocchi', () => {
  it('conserva il numero di pagina su ogni blocco', () => {
    const chunks = splitIntoChunks('Testo di prova sufficientemente lungo da essere indicizzato.', {
      page: 7,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.page).toBe(7);
  });

  it('numera i blocchi in modo continuo fra una pagina e l’altra', () => {
    const prima = splitIntoChunks('Prima pagina con testo a sufficienza per contare.', { page: 1 });
    const seconda = splitIntoChunks('Seconda pagina con altro testo a sufficienza.', {
      page: 2,
      startIndex: prima.length,
    });
    expect(seconda[0]!.chunkIndex).toBe(prima.length);
  });

  it('precalcola i termini canonici del blocco', () => {
    const [chunk] = splitIntoChunks(
      'Le tabelle incrementali riducono i costi di elaborazione rispetto alla ricostruzione.',
    );
    expect(chunk!.terms).toContain('incremental');
    expect(chunk!.terms).toContain('cost');
    // I termini sono un insieme: nessun doppione a gonfiare il punteggio.
    expect(new Set(chunk!.terms).size).toBe(chunk!.terms.length);
  });

  it('scarta i frammenti troppo brevi per dire qualcosa', () => {
    expect(splitIntoChunks('Ok.')).toEqual([]);
    expect(splitIntoChunks('   ')).toEqual([]);
  });

  it('spezza un testo lungo in più blocchi', () => {
    const paragrafo = 'Il partizionamento riduce i costi di scansione delle tabelle grandi. ';
    const chunks = splitIntoChunks(Array.from({ length: 80 }, () => paragrafo).join('\n\n'));
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('testo di una pagina web', () => {
  it('rimuove script e stili e conserva i confini dei blocchi', () => {
    const { title, text } = htmlToText(
      '<html><head><title>Specifica</title><style>p{color:red}</style></head>' +
        '<body><script>alert(1)</script><p>Primo capoverso.</p><p>Secondo capoverso.</p></body></html>',
    );
    expect(title).toBe('Specifica');
    expect(text).toContain('Primo capoverso.');
    expect(text).toContain('Secondo capoverso.');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });

  it('decodifica le entità più comuni', () => {
    const { text } = htmlToText('<p>perch&eacute; l&rsquo;uso &amp; la resa</p>');
    expect(text).toContain('perché');
    expect(text).toContain('&');
  });
});

// ---------------------------------------------------------------------------
// La biblioteca dentro l'indice
// ---------------------------------------------------------------------------

const PDF_CHUNKS = [
  {
    chunkIndex: 0,
    page: 12,
    heading: null,
    content: 'Il coefficiente di assorbimento acustico si misura in camera riverberante.',
    terms: ['coefficiente', 'assorbimento', 'acustico', 'camera', 'riverberante', 'misura'],
  },
  {
    chunkIndex: 1,
    page: 40,
    heading: null,
    content: 'Il coefficiente dichiarato non può superare il valore di prova.',
    terms: ['coefficiente', 'dichiarato', 'valore', 'prova'],
  },
];

const NORMA = {
  id: '99999999-8888-4777-a666-555555555555',
  title: 'Norma sull’assorbimento acustico',
  kind: 'pdf' as const,
  url: null,
  isAuthoritative: true,
  scope: 'project' as const,
};

describe('fonti della biblioteca nell’indice', () => {
  const entries = referenceEntries(NORMA, PDF_CHUNKS);
  const index = buildSourceIndex([...catalogAsEntries(), ...entries]);

  it('trasforma ogni blocco in una voce che porta con sé la pagina', () => {
    expect(entries).toHaveLength(2);
    expect(entries[0]!.page).toBe(12);
    expect(entries[0]!.section).toBe('Pagina 12');
    expect(entries[0]!.origin).toBe('biblioteca');
    expect(entries[0]!.referenceId).toBe(NORMA.id);
  });

  it('propone il PDF, indicando la pagina, per un’affermazione che tratta', () => {
    const risultati = searchIndex(
      index,
      'Il coefficiente di assorbimento acustico si misura in camera riverberante.',
    );
    expect(risultati[0]!.referenceId).toBe(NORMA.id);
    expect(risultati[0]!.page).toBe(12);
    expect(risultati[0]!.url).toBeNull();
  });

  it('non restituisce lo stesso documento tre volte: resta la pagina migliore', () => {
    const risultati = searchIndex(index, 'Il coefficiente dichiarato di assorbimento acustico.');
    const dallaNorma = risultati.filter((r) => r.referenceId === NORMA.id);
    expect(dallaNorma).toHaveLength(1);
  });

  it('non intacca la ricerca sulla documentazione ufficiale', () => {
    const risultati = searchIndex(
      index,
      'Le tabelle incrementali riducono i costi di elaborazione rispetto a una ricostruzione completa.',
      { category: 'prestazioni' },
    );
    expect(risultati[0]!.origin).toBe('catalogo_ufficiale');
    expect(risultati[0]!.url).toBe('https://docs.cloud.google.com/dataform/docs/create-tables');
    // Nessuna voce della biblioteca si intrufola dove non c’entra.
    expect(risultati.every((r) => r.referenceId === null)).toBe(true);
  });

  it('pesa meno una fonte non dichiarata autorevole', () => {
    const autorevole = referenceEntries(NORMA, PDF_CHUNKS);
    const ordinaria = referenceEntries({ ...NORMA, isAuthoritative: false }, PDF_CHUNKS);

    const frase = 'Il coefficiente di assorbimento acustico si misura in camera riverberante.';
    const punteggioAutorevole = searchIndex(
      buildSourceIndex([...catalogAsEntries(), ...autorevole]),
      frase,
    )[0]!.score;
    const punteggioOrdinario = searchIndex(
      buildSourceIndex([...catalogAsEntries(), ...ordinaria]),
      frase,
    )[0]!.score;

    expect(punteggioOrdinario).toBeLessThan(punteggioAutorevole);
  });

  it('tace anche con la biblioteca, quando nulla è pertinente', () => {
    expect(searchIndex(index, 'Il gatto dorme sul divano tutto il pomeriggio.')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unione delle proposte
// ---------------------------------------------------------------------------

function candidato(over: Partial<SearchableEntry> & { score: number }) {
  return {
    url: over.url ?? null,
    title: over.title ?? 'Fonte',
    section: over.section ?? 'Sezione',
    product: null,
    origin: over.origin ?? ('biblioteca' as const),
    referenceId: over.referenceId ?? null,
    page: over.page ?? null,
    score: over.score,
    matchedTerms: ['x', 'y'],
  };
}

describe('unione delle proposte', () => {
  it('fonde i candidati sulla stessa affermazione, ordinati per pertinenza', () => {
    const ufficiali = [
      {
        line: 3,
        statement: 'Frase.',
        category: 'costo' as const,
        candidates: [candidato({ score: 2, url: 'https://a.example', origin: 'catalogo_ufficiale' })],
      },
    ];
    const biblioteca = [
      {
        line: 3,
        statement: 'Frase.',
        category: 'costo' as const,
        candidates: [candidato({ score: 5, referenceId: 'ref-1', page: 4 })],
      },
    ];

    const unite = mergeSuggestions(ufficiali, biblioteca);
    expect(unite).toHaveLength(1);
    expect(unite[0]!.candidates.map((c) => c.score)).toEqual([5, 2]);
    // Una fonte della biblioteca può stare davanti: conta la pertinenza, non
    // la provenienza. A dire da dove viene pensa `origin`.
    expect(unite[0]!.candidates[0]!.origin).toBe('biblioteca');
  });

  it('non duplica lo stesso candidato presente in entrambi gli insiemi', () => {
    const uno = [
      {
        line: 1,
        statement: 'F.',
        category: 'altro' as const,
        candidates: [candidato({ score: 3, url: 'https://a.example' })],
      },
    ];
    expect(mergeSuggestions(uno, uno)[0]!.candidates).toHaveLength(1);
  });

  it('distingue due pagine diverse dello stesso documento', () => {
    const a = [
      {
        line: 1,
        statement: 'F.',
        category: 'altro' as const,
        candidates: [candidato({ score: 3, referenceId: 'ref-1', page: 2 })],
      },
    ];
    const b = [
      {
        line: 1,
        statement: 'F.',
        category: 'altro' as const,
        candidates: [candidato({ score: 2, referenceId: 'ref-1', page: 9 })],
      },
    ];
    expect(mergeSuggestions(a, b)[0]!.candidates).toHaveLength(2);
  });

  it('rispetta il numero massimo di candidati per affermazione', () => {
    const molti = [
      {
        line: 1,
        statement: 'F.',
        category: 'altro' as const,
        candidates: [1, 2, 3, 4, 5].map((n) => candidato({ score: n, referenceId: `ref-${n}` })),
      },
    ];
    expect(mergeSuggestions(molti, [], 3)[0]!.candidates).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// La ricerca su tutte le affermazioni
// ---------------------------------------------------------------------------

describe('ricerca sulle affermazioni di un capitolo', () => {
  const index = buildSourceIndex([
    ...catalogAsEntries(),
    ...referenceEntries(NORMA, PDF_CHUNKS),
  ]);

  const claims: ResearchClaim[] = [
    {
      statement: 'Le tabelle incrementali riducono i costi di elaborazione del 90%.',
      line: 3,
      hasSupportingSource: false,
      category: 'prestazioni',
    },
    {
      statement: 'Il coefficiente di assorbimento acustico si misura in camera riverberante.',
      line: 8,
      hasSupportingSource: false,
      category: 'comportamento',
    },
    {
      statement: 'Una frase con una fonte già presente accanto.',
      line: 12,
      hasSupportingSource: true,
      category: 'costo',
    },
    {
      statement: 'Frase non classificata, di cui non si sa di che parli.',
      line: 20,
      hasSupportingSource: false,
      category: 'altro',
    },
  ];

  const esito = researchClaims(claims, index);

  it('cerca solo per le affermazioni scoperte e classificate', () => {
    expect(esito.examined).toBe(2);
    expect(esito.suggestions.map((s) => s.line)).toEqual([3, 8]);
  });

  it('attinge a entrambe le provenienze secondo l’argomento', () => {
    expect(esito.suggestions.find((s) => s.line === 3)!.candidates[0]!.origin).toBe(
      'catalogo_ufficiale',
    );
    expect(esito.suggestions.find((s) => s.line === 8)!.candidates[0]!.origin).toBe('biblioteca');
  });

  it('non lascia affermazioni senza esito dichiarato', () => {
    expect(esito.suggestions.length + esito.unmatched).toBe(esito.examined);
  });
});
