import { describe, expect, it } from 'vitest';
import {
  sourceAuditorAgent,
  technicalVerifierAgent,
  technicalWriterAgent,
  visualPlanAgent,
} from '@/lib/agents/definitions';
import { buildDependencyDag, toNodeId } from '@/lib/visual/mermaid-dag';
import { analyzeMarkdown } from '@/lib/ingest/markdown';
import type { ChapterInput } from '@/lib/agents/schemas';

/**
 * Il capitolo di prova riproduce i tratti del Capitolo 11: una tabella
 * incrementale senza condizione, un riferimento scritto a mano, una fonte non
 * ufficiale, un'affermazione sui costi senza rimando e un segnaposto immagine.
 */
const CAPITOLO_11 = `# Capitolo 11 — Incremental Tables

## Perché servono

Le tabelle incrementali riducono i costi di elaborazione del 90% rispetto a una
ricostruzione completa, perché elaborano solo le righe nuove.

## Esempio

\`\`\`sqlx
config {
  type: "incremental",
  schema: "analytics"
}

select
  event_date,
  count(*) as eventi
from \`progetto.dataset.eventi_grezzi\`
group by event_date
\`\`\`

\`\`\`
const soglia = 1000;
if (soglia == 1000) { }
\`\`\`

[IMMAGINE: DAG delle dipendenze per le tabelle incrementali]

![](../assets/figura-11.png)

Vedi la [guida su Medium](https://medium.com/esempio) e la
[documentazione ufficiale](https://cloud.google.com/dataform/docs/incremental-tables).
`;

function toInput(markdown: string): ChapterInput {
  const analisi = analyzeMarkdown(markdown);
  return {
    chapterId: '11111111-2222-3333-4444-555555555555',
    number: 11,
    title: 'Incremental Tables',
    contentMd: markdown,
    headings: analisi.headings.map((h) => ({ level: h.level, text: h.text, line: h.line })),
    codeBlocks: analisi.codeBlocks.map((b) => ({ language: b.language, content: b.content, line: b.line })),
    links: analisi.links,
    figures: analisi.figures.map((f) => ({ alt: f.alt, src: f.src, line: f.line })),
    placeholders: analisi.placeholders.map((p) => ({ description: p.description, line: p.line })),
  };
}

const input = toInput(CAPITOLO_11);

/** Le affermazioni che il Technical Verifier consegna al Source Auditor. */
const claims = technicalVerifierAgent.deterministic!(input).claims;

describe('Technical Verifier', () => {
  const output = technicalVerifierAgent.deterministic!(input);

  it('produce un output conforme al proprio contratto', () => {
    expect(technicalVerifierAgent.outputSchema.safeParse(output).success).toBe(true);
  });

  it('rileva la tabella incrementale senza condizione', () => {
    expect(output.codeFindings.map((f) => f.rule)).toContain('incrementale-senza-condizione');
  });

  it('rileva il riferimento scritto a mano invece di ref()', () => {
    expect(output.codeFindings.map((f) => f.rule)).toContain('riferimento-non-dichiarato');
  });

  it('rileva il blocco JavaScript senza linguaggio dichiarato', () => {
    expect(output.codeFindings.map((f) => f.rule)).toContain('blocco-senza-linguaggio');
  });

  it('individua l’affermazione sui costi come verificabile', () => {
    const claim = output.claims.find((c) => c.statement.includes('90%'));
    expect(claim).toBeDefined();
    expect(claim!.category).toBe('prestazioni');
    expect(claim!.hasSupportingSource).toBe(false);
  });

  it('segnala le affermazioni prive di fonte fra i rilievi', () => {
    expect(output.issues.some((i) => i.title === 'Affermazione senza fonte')).toBe(true);
  });

  it('ordina i rilievi dal più grave', () => {
    const ordine = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;
    const valori = output.issues.map((i) => ordine[i.severity]);
    expect([...valori].sort((a, b) => b - a)).toEqual(valori);
  });
});

describe('Source Auditor', () => {
  const output = sourceAuditorAgent.deterministic!({ ...input, claims });

  it('distingue la documentazione ufficiale dalle fonti della comunità', () => {
    const ufficiale = output.citations.find((c) => c.domain === 'cloud.google.com');
    const comunita = output.citations.find((c) => c.domain === 'medium.com');

    expect(ufficiale?.isOfficial).toBe(true);
    expect(comunita?.isOfficial).toBe(false);
    expect(comunita?.note).toMatch(/comunità/i);
  });

  it('segnala la fonte non ufficiale fra i rilievi', () => {
    expect(output.issues.some((i) => i.title === 'Fonte non ufficiale')).toBe(true);
  });

  it('segnala il capitolo privo di qualsiasi riferimento', () => {
    const senzaFonti = sourceAuditorAgent.deterministic!({
      ...toInput('# Titolo\n\nTesto senza link.\n'),
      claims: [],
    });
    expect(senzaFonti.issues.some((i) => i.title === 'Nessun riferimento esterno')).toBe(true);
  });
});

describe('Technical Writer', () => {
  const verifica = technicalVerifierAgent.deterministic!(input);
  const audit = sourceAuditorAgent.deterministic!({ ...input, claims });
  const revisione = technicalWriterAgent.deterministic!({
    ...input,
    issues: verifica.issues,
    suggestions: audit.suggestions,
  });

  it('produce un output conforme al proprio contratto', () => {
    expect(technicalWriterAgent.outputSchema.safeParse(revisione).success).toBe(true);
  });

  it('non altera il significato tecnico', () => {
    expect(revisione.preservesMeaning).toBe(true);
  });

  it('dichiara il linguaggio del blocco che non lo indicava', () => {
    expect(revisione.changes.some((c) => c.kind === 'linguaggio_codice')).toBe(true);
    expect(revisione.contentMd).toContain('```javascript');
  });

  it('aggiunge il testo alternativo mancante', () => {
    expect(revisione.changes.some((c) => c.kind === 'testo_alternativo')).toBe(true);
    expect(revisione.contentMd).toContain('![Figura 11]');
  });

  it('elenca in coda le fonti ufficiali trovate per le affermazioni scoperte', () => {
    expect(revisione.changes.some((c) => c.kind === 'fonte_proposta')).toBe(true);
    expect(revisione.contentMd).toContain('[!TIP]');
    // Il collegamento proposto è pronto da copiare, ma resta in coda: spostarlo
    // dentro la frase è una scelta editoriale, e spetta al revisore.
    expect(revisione.contentMd).toContain('https://docs.cloud.google.com/dataform/docs/create-tables');
  });

  it('tiene separate le affermazioni per cui l’indice non ha nulla', () => {
    const senzaProposta = technicalWriterAgent.deterministic!({
      ...input,
      issues: [
        {
          kind: 'source',
          severity: 'low',
          title: 'Affermazione senza fonte',
          detail: 'Nessuna fonte.',
          suggestion: null,
          location: { line: 400, heading: null, excerpt: 'Affermazione senza riscontro nell’indice.' },
          evidence: [],
        },
      ],
      suggestions: [],
    });

    expect(senzaProposta.changes.some((c) => c.kind === 'nota_verifica')).toBe(true);
    expect(senzaProposta.contentMd).toContain('[!NOTE]');
    expect(senzaProposta.contentMd).not.toContain('[!TIP]');
  });

  it('conserva integralmente il testo originale', () => {
    // Il contenuto originale non viene rimosso: la revisione è additiva.
    expect(revisione.contentMd).toContain('Le tabelle incrementali riducono i costi');
    expect(revisione.contentMd).toContain('# Capitolo 11 — Incremental Tables');
  });

  it('non propone nulla su un capitolo già in ordine', () => {
    const pulito = toInput('# Titolo\n\n```sql\nselect 1;\n```\n\n![Descrizione](a.png)\n');
    const esito = technicalWriterAgent.deterministic!({ ...pulito, issues: [], suggestions: [] });
    expect(esito.changes).toEqual([]);
  });
});

describe('Visual Art Director', () => {
  const verifica = technicalVerifierAgent.deterministic!(input);
  const piano = visualPlanAgent.deterministic!({ ...input, dataformRefs: verifica.dataformRefs });

  it('trasforma ogni segnaposto dell’autore in una voce del piano', () => {
    expect(piano.items.some((i) => i.title.includes('DAG'))).toBe(true);
  });

  it('prevede un diagramma quando il segnaposto parla di DAG', () => {
    const dag = piano.items.find((i) => i.title.includes('DAG'));
    expect(dag?.kind).toBe('diagramma');
  });

  it('assegna sempre un testo alternativo', () => {
    expect(piano.items.every((i) => i.altText.length > 0)).toBe(true);
  });
});

describe('diagramma deterministico', () => {
  it('genera un DAG Mermaid dalle dipendenze dichiarate', () => {
    const diagramma = buildDependencyDag({
      target: 'eventi_giornalieri',
      dependencies: ['eventi_grezzi', 'utenti'],
      isIncremental: true,
    });

    expect(diagramma.mermaid).toContain('flowchart LR');
    expect(diagramma.mermaid).toContain('eventi_grezzi');
    expect(diagramma.mermaid).toContain('-->');
    expect(diagramma.nodeCount).toBe(3);
    expect(diagramma.edgeCount).toBe(2);
    expect(diagramma.altText).toContain('incrementale');
  });

  it('è stabile: stesso input, stesso diagramma', () => {
    const a = buildDependencyDag({ target: 'm', dependencies: ['b', 'a'] });
    const b = buildDependencyDag({ target: 'm', dependencies: ['a', 'b'] });
    expect(a.mermaid).toBe(b.mermaid);
  });

  it('gestisce l’assenza di dipendenze senza produrre un diagramma vuoto', () => {
    const diagramma = buildDependencyDag({ target: 'modello', dependencies: [] });
    expect(diagramma.mermaid).toContain('Nessuna dipendenza dichiarata');
    expect(diagramma.nodeCount).toBe(1);
  });

  it('neutralizza i caratteri non ammessi negli identificatori', () => {
    expect(toNodeId('schema.tabella-x', 3)).toBe('n3_schema_tabella_x');
    expect(toNodeId('!!!', 4)).toBe('n4');
  });

  it('non lascia virgolette non bilanciate nelle etichette', () => {
    const diagramma = buildDependencyDag({ target: 'con "virgolette"', dependencies: [] });
    expect(diagramma.mermaid).not.toContain('""');
  });
});
