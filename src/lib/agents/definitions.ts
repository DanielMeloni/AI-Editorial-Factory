import { z } from 'zod';
import { analyzeCodeBlocks } from './analysis/dataform';
import { extractClaims } from './analysis/claims';
import { assessCitation } from './analysis/sources';
import {
  chapterInputSchema,
  issueSchema,
  revisionOutputSchema,
  sourceAuditOutputSchema,
  technicalVerifierOutputSchema,
  visualPlanOutputSchema,
  type ChapterInput,
  type Issue,
  type RevisionOutput,
  type SourceAuditOutput,
  type TechnicalVerifierOutput,
  type VisualPlanOutput,
} from './schemas';

/**
 * Definizione di un agente.
 *
 * Ogni agente dichiara: che input accetta, che output produce, come si rivolge
 * a un modello e — quando esiste — come ottenere lo stesso risultato in modo
 * deterministico, senza modello.
 *
 * `deterministic` non è un ripiego per i test: è l'implementazione preferita.
 * Un controllo su `type: "incremental"` senza condizione incrementale è un
 * fatto verificabile, non un parere. Il modello serve dove il giudizio è
 * necessario, non dove basta leggere il codice.
 */
export interface AgentDefinition<I, O> {
  key:
    | 'ingestion' | 'source_auditor' | 'curriculum' | 'technical_verifier'
    | 'technical_writer' | 'teaching' | 'visual_art_director' | 'technical_diagram'
    | 'illustration' | 'cover' | 'editorial_reviewer' | 'publishing';
  name: string;
  version: number;
  promptVersion: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  system: string;
  buildPrompt: (input: I) => string;
  /** Implementazione senza modello. Se presente, è quella usata in modalità mock. */
  deterministic?: (input: I) => O;
}

const SEVERITY_ORDER = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;

// ===========================================================================
// Technical Verifier
// ===========================================================================

export const technicalVerifierAgent: AgentDefinition<ChapterInput, TechnicalVerifierOutput> = {
  key: 'technical_verifier',
  name: 'Technical Verifier',
  version: 1,
  promptVersion: 'v1',
  inputSchema: chapterInputSchema,
  outputSchema: technicalVerifierOutputSchema,
  system:
    'Sei un revisore tecnico di manuali su Dataform e BigQuery. Analizzi SQL, SQLX, JavaScript e ' +
    'configurazioni. Segnali soltanto problemi che puoi sostenere con il codice mostrato. ' +
    'Non inventi comportamenti del prodotto. Rispondi in italiano.',

  buildPrompt: (input) =>
    [
      `Capitolo ${input.number ?? '—'}: ${input.title}`,
      '',
      'Blocchi di codice:',
      ...input.codeBlocks.map(
        (block, index) =>
          `[${index + 1}] riga ${block.line}, linguaggio ${block.language ?? 'non dichiarato'}\n${block.content}`,
      ),
      '',
      'Testo del capitolo:',
      input.contentMd,
    ].join('\n'),

  deterministic: (input) => {
    const { findings, refs } = analyzeCodeBlocks(input.codeBlocks);
    const linkLines = new Set(input.links.map((link) => link.line));
    const claims = extractClaims(input.contentMd, linkLines);

    const issues: Issue[] = findings.map((finding) => ({
      kind: 'technical' as const,
      severity: finding.severity,
      title: finding.rule.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      detail: finding.message,
      suggestion: null,
      location: {
        line: finding.line,
        heading: headingAbove(input, finding.line),
        excerpt: null,
      },
      evidence: [],
    }));

    // Un'affermazione senza fonte non è un errore tecnico, ma è un rischio
    // editoriale: viene segnalata come tale.
    for (const claim of claims.filter((c) => !c.hasSupportingSource && c.category !== 'altro')) {
      issues.push({
        kind: 'source',
        severity: claim.category === 'costo' || claim.category === 'prestazioni' ? 'medium' : 'low',
        title: 'Affermazione senza fonte',
        detail: `«${claim.statement.slice(0, 200)}» è un’affermazione verificabile ma non rimanda ad alcuna fonte.`,
        suggestion: 'Collegare la documentazione ufficiale che sostiene l’affermazione.',
        location: { line: claim.line, heading: headingAbove(input, claim.line), excerpt: claim.statement.slice(0, 300) },
        evidence: [],
      });
    }

    issues.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

    return {
      claims,
      issues: issues.slice(0, 200),
      codeFindings: findings.slice(0, 200),
      dataformRefs: refs,
      // L'analisi è deterministica: certezza piena su ciò che afferma, che è
      // solo quanto ricavabile dal codice.
      confidence: 1,
      summary:
        `${findings.length} rilievi sul codice, ${claims.length} affermazioni verificabili, ` +
        `${refs.length} dipendenze Dataform individuate.`,
    };
  },
};

// ===========================================================================
// Source Auditor
// ===========================================================================

export const sourceAuditorAgent: AgentDefinition<ChapterInput, SourceAuditOutput> = {
  key: 'source_auditor',
  name: 'Source Auditor',
  version: 1,
  promptVersion: 'v1',
  inputSchema: chapterInputSchema,
  outputSchema: sourceAuditOutputSchema,
  system:
    'Verifichi completezza e autorevolezza dei riferimenti di un manuale tecnico. ' +
    'Distingui la documentazione ufficiale del produttore dalle fonti della comunità. Rispondi in italiano.',

  buildPrompt: (input) =>
    [
      `Capitolo ${input.number ?? '—'}: ${input.title}`,
      '',
      'Collegamenti presenti:',
      ...input.links.map((link) => `- riga ${link.line}: [${link.text}](${link.url})`),
    ].join('\n'),

  deterministic: (input) => {
    const citations = input.links.map(assessCitation);
    const issues: Issue[] = [];

    for (const citation of citations.filter((c) => !c.isOfficial)) {
      issues.push({
        kind: 'source',
        severity: citation.domain === '' ? 'high' : 'low',
        title: citation.domain === '' ? 'Collegamento non valido' : 'Fonte non ufficiale',
        detail: citation.note ?? `Il dominio ${citation.domain} non è fra le fonti ufficiali.`,
        suggestion:
          citation.domain === ''
            ? 'Correggere l’URL.'
            : 'Affiancare o sostituire con la documentazione ufficiale del prodotto.',
        location: { line: citation.line, heading: headingAbove(input, citation.line), excerpt: citation.url },
        evidence: [citation.url],
      });
    }

    if (citations.length === 0) {
      issues.push({
        kind: 'source',
        severity: 'medium',
        title: 'Nessun riferimento esterno',
        detail: 'Il capitolo non cita alcuna fonte: le affermazioni tecniche restano non verificabili dal lettore.',
        suggestion: 'Aggiungere almeno un rimando alla documentazione ufficiale.',
        location: { line: null, heading: null, excerpt: null },
        evidence: [],
      });
    }

    const ufficiali = citations.filter((c) => c.isOfficial).length;

    return {
      citations,
      issues,
      confidence: 1,
      summary: `${citations.length} riferimenti, di cui ${ufficiali} ufficiali.`,
    };
  },
};

// ===========================================================================
// Technical Writer — proposta di revisione
// ===========================================================================

/** Il Technical Writer riceve il capitolo e i problemi già rilevati. */
export const technicalWriterInputSchema = chapterInputSchema.extend({
  issues: z.array(issueSchema).max(300),
});
export type TechnicalWriterInput = z.infer<typeof technicalWriterInputSchema>;

export const technicalWriterAgent: AgentDefinition<TechnicalWriterInput, RevisionOutput> = {
  key: 'technical_writer',
  name: 'Technical Writer',
  version: 1,
  promptVersion: 'v1',
  inputSchema: technicalWriterInputSchema,
  outputSchema: revisionOutputSchema,
  system:
    'Proponi revisioni a un capitolo tecnico mantenendo la voce dell’autore. ' +
    'Non alteri il significato tecnico. Non aggiungi affermazioni non presenti nell’originale. Rispondi in italiano.',

  buildPrompt: (input) =>
    [
      `Capitolo ${input.number ?? '—'}: ${input.title}`,
      '',
      'Problemi rilevati:',
      ...input.issues.map((issue) => `- [${issue.severity}] riga ${issue.location.line ?? '—'}: ${issue.title} — ${issue.detail}`),
      '',
      'Testo originale:',
      input.contentMd,
    ].join('\n'),

  /**
   * Revisione deterministica: solo interventi che non toccano il merito.
   *
   *  - dichiara il linguaggio dei blocchi di codice che non lo indicano;
   *  - annota il testo alternativo mancante sulle immagini;
   *  - inserisce una nota di verifica accanto alle affermazioni senza fonte.
   *
   * Non riscrive frasi e non aggiunge contenuto tecnico: quello richiede un
   * modello, e comunque l'approvazione umana.
   */
  deterministic: (input) => {
    const lines = input.contentMd.split(/\r?\n/);
    const changes: RevisionOutput['changes'] = [];

    // 1. Linguaggio mancante sui blocchi di codice.
    for (const block of input.codeBlocks) {
      if (block.language !== null) continue;
      const index = block.line - 1;
      const line = lines[index];
      if (line === undefined) continue;

      const fence = /^(\s{0,3})(`{3,}|~{3,})\s*$/.exec(line);
      if (!fence) continue;

      const inferred = inferLanguage(block.content);
      lines[index] = `${fence[1]}${fence[2]}${inferred}`;
      changes.push({
        kind: 'linguaggio_codice',
        line: block.line,
        description: `Dichiarato il linguaggio «${inferred}», dedotto dal contenuto del blocco.`,
      });
    }

    // 2. Testo alternativo mancante sulle immagini.
    for (const figure of input.figures) {
      if (figure.alt.trim() !== '') continue;
      const index = figure.line - 1;
      const line = lines[index];
      if (line === undefined) continue;

      const suggerito = descrizioneDaPercorso(figure.src);
      lines[index] = line.replace('![]', `![${suggerito}]`);
      changes.push({
        kind: 'testo_alternativo',
        line: figure.line,
        description: `Aggiunto testo alternativo «${suggerito}»: da rivedere prima dell’approvazione.`,
      });
    }

    // 3. Nota di verifica sulle affermazioni prive di fonte, in coda al documento
    //    per non spezzare la lettura.
    const daVerificare = input.issues.filter((issue) => issue.title === 'Affermazione senza fonte');
    if (daVerificare.length > 0) {
      lines.push(
        '',
        '<!-- Nota della revisione automatica: affermazioni da corredare di fonte -->',
        '> [!NOTE]',
        '> Le seguenti affermazioni risultano prive di un riferimento verificabile:',
        ...daVerificare
          .slice(0, 20)
          .map((issue) => `> - riga ${issue.location.line ?? '—'}: ${issue.location.excerpt ?? issue.detail}`),
      );
      changes.push({
        kind: 'nota_verifica',
        line: lines.length,
        description: `Elencate in coda ${daVerificare.length} affermazioni da corredare di fonte.`,
      });
    }

    return {
      contentMd: lines.join('\n'),
      changes,
      preservesMeaning: true,
      confidence: 1,
      summary:
        changes.length === 0
          ? 'Nessun intervento necessario: il capitolo non presenta problemi correggibili in modo deterministico.'
          : `${changes.length} interventi proposti, nessuno dei quali altera il significato tecnico.`,
    };
  },
};

// ===========================================================================
// Visual Art Director — piano visuale
// ===========================================================================

/** Il Visual Art Director riceve anche le dipendenze individuate nel codice. */
export const visualPlanInputSchema = chapterInputSchema.extend({
  dataformRefs: z.array(z.string()).max(200),
});
export type VisualPlanInput = z.infer<typeof visualPlanInputSchema>;

export const visualPlanAgent: AgentDefinition<VisualPlanInput, VisualPlanOutput> = {
  key: 'visual_art_director',
  name: 'Visual Art Director',
  version: 1,
  promptVersion: 'v1',
  inputSchema: visualPlanInputSchema,
  outputSchema: visualPlanOutputSchema,
  system:
    'Definisci quali figure servono a un capitolo tecnico: diagrammi precisi per architetture e ' +
    'dipendenze, illustrazioni concettuali per le idee. Rispondi in italiano.',

  buildPrompt: (input) =>
    [
      `Capitolo ${input.number ?? '—'}: ${input.title}`,
      `Dipendenze Dataform: ${input.dataformRefs.join(', ') || 'nessuna'}`,
      `Segnaposto immagine già presenti: ${input.placeholders.length}`,
    ].join('\n'),

  deterministic: (input) => {
    const items: VisualPlanOutput['items'] = [];

    // Se il capitolo dichiara dipendenze, il grafo è la figura più utile: è
    // preciso, verificabile e non richiede un modello visuale.
    if (input.dataformRefs.length > 0) {
      items.push({
        kind: 'diagramma',
        diagramType: 'dag',
        title: `Grafo delle dipendenze — ${input.title}`,
        caption: `Dipendenze dichiarate con ref(): ${input.dataformRefs.join(', ')}.`,
        altText: `Diagramma delle dipendenze fra ${input.dataformRefs.length} tabelle sorgente e il modello descritto nel capitolo.`,
        line: input.codeBlocks[0]?.line ?? 1,
        rationale:
          'Le dipendenze sono dichiarate nel codice: un diagramma generato da esse è esatto per costruzione.',
      });
    }

    // Ogni segnaposto lasciato dall'autore diventa una voce del piano.
    for (const placeholder of input.placeholders) {
      const wantsDiagram = /\b(dag|flusso|pipeline|architettura|schema|sequenza)\b/i.test(
        placeholder.description,
      );
      items.push({
        kind: wantsDiagram ? 'diagramma' : 'illustrazione',
        diagramType: wantsDiagram ? 'flusso' : null,
        title: placeholder.description.slice(0, 200) || 'Figura richiesta dall’autore',
        caption: placeholder.description.slice(0, 500),
        altText: placeholder.description.slice(0, 500),
        line: placeholder.line,
        rationale: 'Segnaposto lasciato dall’autore nel testo originale.',
      });
    }

    return {
      items,
      confidence: 1,
      summary:
        items.length === 0
          ? 'Nessuna figura necessaria: il capitolo non dichiara dipendenze né segnaposto.'
          : `${items.length} figure previste, di cui ${items.filter((i) => i.kind === 'diagramma').length} diagrammi deterministici.`,
    };
  },
};

// ---------------------------------------------------------------------------
// Ausiliari
// ---------------------------------------------------------------------------

function headingAbove(input: ChapterInput, line: number | null): string | null {
  if (line === null) return null;
  let found: string | null = null;
  for (const heading of input.headings) {
    if (heading.line <= line) found = heading.text;
    else break;
  }
  return found;
}

function inferLanguage(content: string): string {
  if (/\bconfig\s*\{/.test(content) && /\bref\s*\(/.test(content)) return 'sqlx';
  if (/\bselect\b/i.test(content) && /\bfrom\b/i.test(content)) return 'sql';
  if (/\b(const|let|function|module\.exports|=>)\b/.test(content)) return 'javascript';
  if (/^\s*\{[\s\S]*\}\s*$/.test(content)) return 'json';
  if (/^\s*(\$|#)\s/m.test(content)) return 'bash';
  return 'text';
}

function descrizioneDaPercorso(src: string): string {
  const nome = src.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') ?? 'figura';
  return nome.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
