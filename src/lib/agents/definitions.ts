import { z } from 'zod';
import { analyzeCodeBlocks } from './analysis/dataform';
import { extractClaims } from './analysis/claims';
import { assessCitation } from './analysis/sources';
import { CATALOG_ENTRIES } from '@/lib/sources/catalog';
import { findSources, OFFICIAL_INDEX } from '@/lib/sources/match';
import { researchClaims } from '@/lib/sources/research';
import {
  blogArticleInputSchema,
  blogArticleOutputSchema,
  blogPlanInputSchema,
  blogPlanOutputSchema,
  chapterApparatusOutputSchema,
  chapterDraftInputSchema,
  chapterPlanOutputSchema,
  chapterSectionOutputSchema,
  courseLessonInputSchema,
  courseLessonOutputSchema,
  coursePlanInputSchema,
  coursePlanOutputSchema,
  chapterInputSchema,
  issueSchema,
  revisionOutputSchema,
  sourceAuditOutputSchema,
  sourceDiscoveryInputSchema,
  sourceDiscoveryOutputSchema,
  sourceSuggestionSchema,
  technicalVerifierOutputSchema,
  verifiableClaimSchema,
  visualPlanOutputSchema,
  type BlogArticleInput,
  type BlogArticleOutput,
  type BlogPlanInput,
  type BlogPlanOutput,
  type ChapterApparatusOutput,
  type ChapterDraftInput,
  type ChapterPlanOutput,
  type ChapterSectionOutput,
  type CourseLessonInput,
  type CourseLessonOutput,
  type CoursePlanInput,
  type CoursePlanOutput,
  type ChapterInput,
  type Issue,
  type RevisionOutput,
  type SourceAuditOutput,
  type SourceDiscoveryInput,
  type SourceDiscoveryOutput,
  type SourceSuggestion,
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
    | 'ingestion'
    | 'source_auditor'
    | 'curriculum'
    | 'technical_verifier'
    | 'technical_writer'
    | 'teaching'
    | 'visual_art_director'
    | 'technical_diagram'
    | 'illustration'
    | 'cover'
    | 'editorial_reviewer'
    | 'publishing';
  name: string;
  version: number;
  promptVersion: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  system: string;
  /** Tetto di token in uscita, dove il predefinito non basta. */
  maxOutputTokens?: number;
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
        location: {
          line: claim.line,
          heading: headingAbove(input, claim.line),
          excerpt: claim.statement.slice(0, 300),
        },
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

/**
 * Il Source Auditor riceve anche le affermazioni individuate dal Technical
 * Verifier: senza di esse potrebbe giudicare le fonti presenti, ma non cercare
 * quelle che mancano.
 */
export const sourceAuditorInputSchema = chapterInputSchema.extend({
  claims: z.array(verifiableClaimSchema).max(200),
});
export type SourceAuditorInput = z.infer<typeof sourceAuditorInputSchema>;

export const sourceAuditorAgent: AgentDefinition<SourceAuditorInput, SourceAuditOutput> = {
  key: 'source_auditor',
  name: 'Source Auditor',
  version: 2,
  promptVersion: 'v2',
  inputSchema: sourceAuditorInputSchema,
  outputSchema: sourceAuditOutputSchema,
  system:
    'Verifichi completezza e autorevolezza dei riferimenti di un manuale tecnico e proponi la ' +
    'pagina ufficiale che sostiene ogni affermazione priva di fonte. Distingui la documentazione ' +
    'ufficiale del produttore dalle fonti della comunità. Non citare mai un URL che non ti è ' +
    'stato fornito nell’elenco delle pagine disponibili. Rispondi in italiano.',

  buildPrompt: (input) =>
    [
      `Capitolo ${input.number ?? '—'}: ${input.title}`,
      '',
      'Collegamenti presenti:',
      ...input.links.map((link) => `- riga ${link.line}: [${link.text}](${link.url})`),
      '',
      'Affermazioni prive di fonte:',
      ...input.claims
        .filter((claim) => !claim.hasSupportingSource)
        .map((claim) => `- riga ${claim.line} [${claim.category}]: ${claim.statement}`),
      '',
      'Pagine ufficiali disponibili — scegli soltanto fra queste:',
      ...CATALOG_ENTRIES.map((entry) => `- ${entry.url} — ${entry.title} (${entry.section})`),
    ].join('\n'),

  deterministic: (input) => {
    const citations = input.links.map(assessCitation);
    const issues: Issue[] = [];

    // 1. Autorevolezza e validità dei riferimenti già presenti.
    for (const citation of citations.filter((c) => !c.isOfficial)) {
      const alternative = citation.domain === '' ? [] : findSources(citation.text, { limit: 1 });

      issues.push({
        kind: 'source',
        severity: citation.domain === '' ? 'high' : 'low',
        title: citation.domain === '' ? 'Collegamento non valido' : 'Fonte non ufficiale',
        detail: citation.note ?? `Il dominio ${citation.domain} non è fra le fonti ufficiali.`,
        suggestion:
          citation.domain === ''
            ? 'Correggere l’URL.'
            : alternative.length > 0
              ? `Affiancare o sostituire con la documentazione ufficiale: ${alternative[0]!.title} — ${alternative[0]!.url ?? ''}`
              : 'Affiancare o sostituire con la documentazione ufficiale del prodotto.',
        location: {
          line: citation.line,
          heading: headingAbove(input, citation.line),
          excerpt: citation.url,
        },
        evidence: [citation.url],
      });
    }

    // 2. Riferimento ufficiale che l'indice non conosce: la documentazione viene
    //    riorganizzata spesso, e un collegamento morto è peggio di uno assente.
    for (const citation of citations.filter(
      (c) => c.verification === 'ufficiale_non_indicizzata',
    )) {
      issues.push({
        kind: 'source',
        severity: 'low',
        title: 'Riferimento ufficiale da verificare',
        detail:
          `La pagina ${citation.url} è su un dominio ufficiale ma non risulta nell’indice ` +
          'curato: potrebbe essere stata spostata o rinominata.',
        suggestion: 'Aprire il collegamento e, se necessario, aggiornarlo.',
        location: {
          line: citation.line,
          heading: headingAbove(input, citation.line),
          excerpt: citation.url,
        },
        evidence: [citation.url],
      });
    }

    if (citations.length === 0) {
      issues.push({
        kind: 'source',
        severity: 'medium',
        title: 'Nessun riferimento esterno',
        detail:
          'Il capitolo non cita alcuna fonte: le affermazioni tecniche restano non verificabili dal lettore.',
        suggestion: 'Aggiungere almeno un rimando alla documentazione ufficiale.',
        location: { line: null, heading: null, excerpt: null },
        evidence: [],
      });
    }

    // 3. Ricerca automatica delle fonti mancanti.
    //
    //    L'agente interroga la sola documentazione ufficiale: è puro, non tocca
    //    il database, e il suo esito è riproducibile da chiunque abbia lo stesso
    //    indice. La biblioteca del progetto — link e PDF caricati dall'autore —
    //    viene interrogata subito dopo, in un passaggio che ha accesso ai dati.
    const research = researchClaims(input.claims, OFFICIAL_INDEX);
    const suggestions: SourceSuggestion[] = research.suggestions;
    const unmatchedClaims = research.unmatched;

    for (const suggestion of suggestions) {
      const best = suggestion.candidates[0]!;
      issues.push({
        kind: 'source',
        severity: 'info',
        title: 'Fonte ufficiale proposta',
        detail:
          `Per «${suggestion.statement.slice(0, 160)}» l’indice ufficiale propone «${best.title}» ` +
          `(${best.section}). Termini in comune: ${best.matchedTerms.join(', ')}.`,
        suggestion:
          best.url !== null
            ? `Valutare l’inserimento del rimando: ${best.url}`
            : `Valutare il richiamo alla fonte «${best.title}»${best.page !== null ? `, pagina ${best.page}` : ''}.`,
        location: {
          line: suggestion.line,
          heading: headingAbove(input, suggestion.line),
          excerpt: suggestion.statement.slice(0, 300),
        },
        evidence: suggestion.candidates.map(
          (candidate) => candidate.url ?? `${candidate.title} — pagina ${candidate.page ?? '—'}`,
        ),
      });
    }

    const ufficiali = citations.filter((c) => c.isOfficial).length;
    const daVerificare = citations.filter(
      (c) => c.verification === 'ufficiale_non_indicizzata',
    ).length;

    return {
      citations,
      suggestions,
      unmatchedClaims,
      issues,
      // La ricerca è deterministica: la certezza riguarda ciò che l'indice
      // contiene, non ciò che esiste al mondo.
      confidence: 1,
      summary:
        `${citations.length} riferimenti, di cui ${ufficiali} ufficiali` +
        (daVerificare > 0 ? ` (${daVerificare} da verificare)` : '') +
        `. ${suggestions.length} fonti proposte su ${research.examined} affermazioni prive di rimando` +
        (unmatchedClaims > 0
          ? `; per ${unmatchedClaims} l’indice non ha nulla di pertinente.`
          : '.'),
    };
  },
};

// ===========================================================================
// Technical Writer — proposta di revisione
// ===========================================================================

/**
 * Il Technical Writer riceve il capitolo, i problemi già rilevati e le fonti
 * che il Source Auditor ha trovato nell'indice ufficiale.
 */
export const technicalWriterInputSchema = chapterInputSchema.extend({
  issues: z.array(issueSchema).max(300),
  suggestions: z.array(sourceSuggestionSchema).max(100),
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
      ...input.issues.map(
        (issue) =>
          `- [${issue.severity}] riga ${issue.location.line ?? '—'}: ${issue.title} — ${issue.detail}`,
      ),
      '',
      'Fonti ufficiali già individuate (usa soltanto questi URL):',
      ...input.suggestions.flatMap((suggestion) => [
        `- riga ${suggestion.line}: ${suggestion.statement.slice(0, 160)}`,
        ...suggestion.candidates.map((candidate) => `    · ${candidate.title} — ${candidate.url}`),
      ]),
      '',
      'Testo originale:',
      input.contentMd,
    ].join('\n'),

  /**
   * Revisione deterministica: solo interventi che non toccano il merito.
   *
   *  - dichiara il linguaggio dei blocchi di codice che non lo indicano;
   *  - annota il testo alternativo mancante sulle immagini;
   *  - elenca in coda le fonti ufficiali trovate per le affermazioni che ne
   *    erano prive, e separatamente quelle rimaste senza.
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

    // 3. Fonti trovate nell'indice ufficiale, in coda al documento.
    //
    //    Il collegamento non viene inserito nella frase: spostarlo dentro il
    //    testo è una scelta editoriale, e spetta al revisore. Qui la proposta
    //    viene messa a disposizione, con l'URL già pronto da copiare.
    if (input.suggestions.length > 0) {
      lines.push(
        '',
        '<!-- Nota della revisione automatica: fonti ufficiali proposte -->',
        '> [!TIP]',
        '> Fonti ufficiali trovate per le affermazioni prive di rimando:',
      );

      for (const suggestion of input.suggestions.slice(0, 20)) {
        lines.push(`> - riga ${suggestion.line}: ${suggestion.statement.slice(0, 200)}`);
        for (const candidate of suggestion.candidates.slice(0, 3)) {
          lines.push(`>   - [${candidate.title}](${candidate.url}) — ${candidate.section}`);
        }
      }

      changes.push({
        kind: 'fonte_proposta',
        line: lines.length,
        description:
          `Proposte in coda ${input.suggestions.length} fonti ufficiali, tratte dall’indice ` +
          'curato e da valutare in revisione.',
      });
    }

    // 4. Nota di verifica sulle affermazioni rimaste senza fonte, in coda al
    //    documento per non spezzare la lettura.
    const conProposta = new Set(input.suggestions.map((suggestion) => suggestion.line));
    const daVerificare = input.issues.filter(
      (issue) =>
        issue.title === 'Affermazione senza fonte' &&
        !(issue.location.line !== null && conProposta.has(issue.location.line)),
    );

    if (daVerificare.length > 0) {
      lines.push(
        '',
        '<!-- Nota della revisione automatica: affermazioni da corredare di fonte -->',
        '> [!NOTE]',
        '> Le seguenti affermazioni restano prive di un riferimento verificabile, e ' +
          'l’indice ufficiale non contiene nulla di pertinente:',
        ...daVerificare
          .slice(0, 20)
          .map(
            (issue) =>
              `> - riga ${issue.location.line ?? '—'}: ${issue.location.excerpt ?? issue.detail}`,
          ),
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
  version: 2,
  promptVersion: 'v2',
  inputSchema: visualPlanInputSchema,
  outputSchema: visualPlanOutputSchema,
  system:
    'Definisci quali visual servono a un capitolo tecnico distinguendo concetto, procedura e risultato. ' +
    'Usa diagrammi deterministici per architetture e dipendenze, screenshot reali annotati per le ' +
    'procedure UI e immagini di stato atteso per confermare il risultato. Rispondi in italiano.',

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
        role: 'concetto',
        requiresRealCapture: false,
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
      const wantsExpectedState = /\b(risultato|dovresti vedere|expected state|output)\b/i.test(
        placeholder.description,
      );
      const wantsScreenshot = /\b(console|interfaccia|ui|clic|menu|pulsante|schermata)\b/i.test(
        placeholder.description,
      );
      items.push({
        kind: wantsDiagram
          ? 'diagramma'
          : wantsExpectedState
            ? 'risultato_atteso'
            : wantsScreenshot
              ? 'screenshot'
              : 'illustrazione',
        diagramType: wantsDiagram ? 'flusso' : null,
        role: wantsExpectedState ? 'risultato' : wantsScreenshot ? 'procedura' : 'concetto',
        requiresRealCapture: wantsScreenshot || wantsExpectedState,
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
  const nome =
    src
      .split('/')
      .pop()
      ?.replace(/\.[a-z0-9]+$/i, '') ?? 'figura';
  return nome.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// ===========================================================================
// Source Discovery — scelta delle fonti trovate sul web
// ===========================================================================

/**
 * Sceglie, fra indirizzi **già verificati**, quali servono come base del manuale.
 *
 * L'agente non cerca e non naviga: riceve un elenco di pagine che sono state
 * aperte davvero e decide quali tenere, motivando ogni scelta. La divisione è
 * netta di proposito — chi cerca non giudica, chi giudica non inventa — e
 * rende l'output verificabile: ogni URL nella risposta è uno di quelli
 * dell'input, e questo si può controllare, non solo sperare.
 */
export const sourceDiscoveryAgent: AgentDefinition<SourceDiscoveryInput, SourceDiscoveryOutput> = {
  key: 'source_auditor',
  name: 'Source Auditor · ricerca web',
  version: 1,
  promptVersion: 'v1-web',
  inputSchema: sourceDiscoveryInputSchema,
  outputSchema: sourceDiscoveryOutputSchema,
  system:
    'Scegli le fonti di riferimento utili a scrivere un manuale tecnico. Ricevi un elenco di ' +
    'pagine già verificate: puoi soltanto sceglierle, mai aggiungerne. Ogni URL della tua ' +
    'risposta deve comparire identico nell’elenco ricevuto. Preferisci la documentazione del ' +
    'produttore; una fonte della comunità la tieni solo se copre un argomento che la ' +
    'documentazione non tratta, e lo dici. Motiva ogni scelta in una frase concreta, riferita a ' +
    'questo manuale. Rispondi in italiano.',

  buildPrompt: (input) =>
    [
      `Manuale: ${input.projectTitle}${input.subtitle ? ` — ${input.subtitle}` : ''}`,
      `Lingua: ${input.language}`,
      '',
      'Argomenti trattati:',
      ...input.topics.map((topic) => `- ${topic}`),
      '',
      'Pagine verificate fra cui scegliere:',
      ...input.candidates.map(
        (candidate, index) =>
          `[${index + 1}] ${candidate.url}\n` +
          `    titolo: ${candidate.title || '(nessuno)'}\n` +
          `    dominio: ${candidate.domain}${candidate.isOfficial ? ' (ufficiale)' : candidate.isCommunity ? ' (comunità)' : ''}\n` +
          (candidate.excerpt ? `    estratto: ${candidate.excerpt.slice(0, 300)}\n` : ''),
      ),
      '',
      'Formato obbligatorio della risposta:',
      '- `selected` è sempre un array JSON (anche quando è vuoto), massimo 40 elementi.',
      '- `discarded` è sempre un array JSON (anche quando è vuoto), massimo 60 elementi.',
      '- Non sostituire mai gli array con testo, elenchi Markdown o valori separati da virgole.',
      '- Ogni pagina ricevuta deve comparire una sola volta: in `selected` oppure in `discarded`.',
    ].join('\n'),

  /**
   * Selezione senza modello.
   *
   * Che una pagina stia sul dominio del produttore è un fatto, non un parere:
   * basta guardare. La documentazione ufficiale viene tenuta, la comunità
   * scartata con motivo. È una scelta più povera di quella di un modello — non
   * sa dire *perché* una pagina serva a questo volume — ma è vera, e permette
   * di percorrere l'intero flusso senza spendere un centesimo.
   */
  deterministic: (input) => {
    const selected: SourceDiscoveryOutput['selected'] = [];
    const discarded: SourceDiscoveryOutput['discarded'] = [];

    for (const candidate of input.candidates) {
      if (!candidate.isOfficial) {
        discarded.push({
          url: candidate.url,
          reason: candidate.isCommunity
            ? 'Fonte della comunità: senza un modello che ne valuti il contributo, non viene proposta.'
            : 'Dominio non riconosciuto fra le fonti ufficiali del prodotto.',
        });
        continue;
      }

      const isReference = /\/reference\/|\/api\/|\/rest\b/.test(candidate.url);
      selected.push({
        url: candidate.url,
        title: candidate.title || candidate.domain,
        kind: isReference ? 'riferimento_api' : 'documentazione_ufficiale',
        rationale: `Documentazione ufficiale su ${candidate.domain}: è la fonte primaria per il comportamento del prodotto.`,
        priority: 1,
      });
    }

    return {
      selected,
      discarded,
      // Certezza piena su ciò che afferma, che è soltanto: «questo dominio è
      // quello del produttore». Sull'utilità per il volume non si pronuncia.
      confidence: 1,
      summary:
        `${selected.length} fonti ufficiali su ${input.candidates.length} pagine verificate. ` +
        'Selezione per dominio: senza un modello, la pertinenza all’argomento non viene valutata.',
    };
  },
};

// ===========================================================================
// Stesura del capitolo — piano, sezioni, apparato
// ===========================================================================

/**
 * Convenzioni redazionali della collana, ricavate dal volume già pubblicato.
 *
 * Stanno qui, in una costante sola, perché tre agenti diversi devono
 * rispettarle allo stesso modo: se ognuno le ripetesse a modo suo, i capitoli
 * generati divergerebbero fra loro prima ancora di divergere dal libro.
 */
const CONVENZIONI =
  'Convenzioni della collana, da rispettare alla lettera:\n' +
  '- Il codice inline indica file, tabelle, funzioni, parametri e valori.\n' +
  '- I blocchi di codice mostrano SQLX, JavaScript o comandi completi; dove utile segue l’output atteso.\n' +
  '- I riquadri si aprono con una riga «> **NOTA**», «> **SUGGERIMENTO**», «> **IMPORTANTE**» o ' +
  '«> **ATTENZIONE**» e proseguono come citazione. NOTA approfondisce, SUGGERIMENTO indica una buona ' +
  'pratica, IMPORTANTE fissa un concetto, ATTENZIONE segnala un errore comune o un rischio.\n' +
  '- I segnaposto dei valori da sostituire sono in MAIUSCOLO_UNDERSCORE, come PROJECT_ID.\n' +
  '- Le figure si dichiarano con «[IMMAGINE: descrizione di cosa deve mostrare]» seguito da una ' +
  'didascalia «Figura N.x – titolo». La descrizione specifica anche il tipo (diagramma di flusso, ' +
  'architettura, sequenza, confronto o illustrazione) e gli elementi essenziali da rappresentare. ' +
  'L’immagine non si descrive a parole nel testo corrente.\n' +
  '- Usa un diagramma di flusso per processi, decisioni e percorsi con più passaggi; usa ' +
  'un’illustrazione soltanto quando una rappresentazione concettuale chiarisce meglio del testo. ' +
  'Ogni figura deve avere uno scopo didattico preciso, essere richiamata nel punto pertinente e ' +
  'non duplicare una tabella o un elenco già sufficienti.\n' +
  '- Il caso di studio è l’e-commerce NordShop: progetto dataform-nordshop-lab, repository ' +
  'nordshop-analytics, dataset raw, analytics e sandbox, tabelle raw.customers, raw.products, ' +
  'raw.orders, raw.order_items. Non sono segnaposto: sono i nomi concreti da usare.\n' +
  '- Non inserire mai «TODO» o «da completare»: una lacuna si dichiara in «gaps», non si nasconde nel testo.\n' +
  '- Nel testo non compaiono URL, collegamenti né rimandi bibliografici. Le fonti sono raccolte ' +
  'in un capitolo di bibliografia a parte: nomina pure «la documentazione ufficiale di Dataform», ' +
  'ma senza indirizzo.';

/**
 * Piano del capitolo.
 *
 * Prima le sezioni, poi il testo. Il piano è ciò che permette di scrivere un
 * capitolo lungo senza che si accorci da solo per entrare in una risposta.
 */
export const chapterPlanAgent: AgentDefinition<ChapterDraftInput, ChapterPlanOutput> = {
  key: 'technical_writer',
  name: 'Chapter Planner',
  version: 1,
  promptVersion: 'v2',
  inputSchema: chapterDraftInputSchema,
  outputSchema: chapterPlanOutputSchema,
  maxOutputTokens: 4000,
  system:
    'Progetti la scaletta di un capitolo di manuale tecnico. Ti basi esclusivamente sugli estratti ' +
    'forniti. Le sezioni procedono dal problema alla soluzione, poi ai componenti, poi al confronto ' +
    'con le alternative: ogni sezione ha un compito distinto e nessuna ripete la precedente. ' +
    'Dichiari in apertura da 3 a 6 obiettivi concreti, scritti come ciò che il lettore saprà fare. ' +
    'Rispondi in italiano.',

  buildPrompt: (input) =>
    [
      `Capitolo ${input.number ?? '—'}: ${input.title}`,
      input.partTitle ? `Parte: ${input.partTitle}` : '',
      input.objective ? `Obiettivo dichiarato in fase di struttura: ${input.objective}` : '',
      '',
      input.direzione,
      '',
      'Posizione nel flusso globale del manuale:',
      ...input.manualOutline.map((title) => `- ${title}`),
      input.previousChapters.length ? '' : '',
      ...(input.previousChapters.length
        ? [
            'Capitoli precedenti già approvati — dai questi contenuti per acquisiti e non ripeterli:',
            ...input.previousChapters.map((item) => `- ${item.title}: ${item.summary}`),
          ]
        : []),
      '',
      'Estratti disponibili:',
      input.evidence || '(nessun estratto disponibile)',
      '',
      'Progetta da 4 a 8 sezioni di corpo. Non includere riassunto, punti chiave o ' +
        'riferimenti: sono apparato e vengono composti a parte. Non prevedere quiz, esercizi o laboratori.',
      'Distribuisci nel capitolo da 2 a 4 sezioni con `needsFigure: true`, quando il materiale lo ' +
        'consente. Scegli i punti in cui una figura riduce davvero il carico cognitivo: flussi per ' +
        'processi o decisioni, sequenze per interazioni temporali, architetture per componenti e ' +
        'illustrazioni per concetti difficili da immaginare. Non concentrare tutte le figure in una ' +
        'sola parte e non usarle come decorazione.',
    ]
      .filter(Boolean)
      .join('\n'),
  deterministic: (input) => {
    const titoliEsistenti = Array.from(input.existingContent.matchAll(/^##\s+(.+)$/gm))
      .map((match) => match[1]!.replace(/^\d+(?:\.\d+)*\s+/, '').trim())
      .filter((titolo) => !/obiettivi|riassunto|punti chiave|quiz|laboratorio|buone pratiche|errori comuni/i.test(titolo));
    const fallback = [
      `Il problema affrontato da ${input.title}`,
      'Concetti e componenti fondamentali',
      'Flusso operativo e applicazione',
      'Verifica del risultato e limiti',
    ];
    const titoli = (titoliEsistenti.length >= 3 ? titoliEsistenti : fallback).slice(0, 8);
    const obiettivoBase = input.objective.replace(/\s+/g, ' ').trim();
    return {
      objectives: [
        obiettivoBase || `Comprendere lo scopo di ${input.title}`,
        `Distinguere i componenti principali di ${input.title}`,
        `Applicare e verificare il flusso descritto nel capitolo`,
      ],
      sections: titoli.map((title, index) => {
        const blocco = estraiSezioneMarkdown(input.existingContent, title);
        return {
          title,
          intent: `Spiegare ${title.toLowerCase()} usando esclusivamente il contenuto e gli estratti disponibili.`,
          needsCode: /```/.test(blocco),
          needsFigure: /\[IMMAGINE:/i.test(blocco) || index === 1,
        };
      }),
      confidence: input.existingContent.trim().length > 500 ? 0.9 : input.evidence.trim() ? 0.7 : 0.35,
    };
  },
};

export interface ChapterSectionInput extends ChapterDraftInput {
  sectionTitle: string;
  sectionIntent: string;
  needsCode: boolean;
  needsFigure: boolean;
  /** Numero del capitolo e posizione, per numerare titoli e figure. */
  sectionNumber: number;
  /** Le altre sezioni, così che non si ripetano né si contraddicano. */
  outline: string[];
  objectives: string[];
}

export const chapterSectionInputSchema = chapterDraftInputSchema.extend({
  sectionTitle: z.string().max(200),
  sectionIntent: z.string().max(600),
  needsCode: z.boolean(),
  needsFigure: z.boolean(),
  sectionNumber: z.number().int().positive(),
  outline: z.array(z.string().max(200)).max(12),
  objectives: z.array(z.string().max(300)).max(8),
});

/** Scrive una sezione per volta, con lo spazio per essere completa. */
export const chapterSectionAgent: AgentDefinition<ChapterSectionInput, ChapterSectionOutput> = {
  key: 'technical_writer',
  name: 'Chapter Section Writer',
  version: 1,
  promptVersion: 'v2',
  inputSchema: chapterSectionInputSchema as unknown as z.ZodType<ChapterSectionInput>,
  outputSchema: chapterSectionOutputSchema,
  maxOutputTokens: 8000,
  system:
    'Scrivi una singola sezione di un capitolo di manuale tecnico, per un lettore professionista. ' +
    'Ti basi esclusivamente sugli estratti forniti: non aggiungi fatti, numeri, opzioni di ' +
    'configurazione o limiti che non compaiano nelle fonti, e non inventi URL. Dove le fonti non ' +
    'bastano lo annoti in «gaps» e prosegui. Non inserisci URL né collegamenti: le fonti vivono ' +
    'nel capitolo di bibliografia. Scrivi dai 400 agli 800 parole: una sezione di tre ' +
    'righe non è una sezione. Spieghi il perché prima del come, e usi analogie concrete quando ' +
    'chiariscono. Rispondi in italiano.\n\n' +
    CONVENZIONI,

  buildPrompt: (input) =>
    [
      `Capitolo ${input.number ?? '—'}: ${input.title}`,
      `Obiettivi del capitolo: ${input.objectives.join(' · ')}`,
      '',
      input.direzione,
      '',
      'Scaletta completa del capitolo — le altre sezioni esistono già o esisteranno, non invaderle:',
      ...input.outline.map(
        (titolo, indice) =>
          `${indice + 1 === input.sectionNumber ? '→ ' : '  '}${input.number ?? ''}.${indice + 1} ${titolo}`,
      ),
      '',
      `Sezione da scrivere: ${input.number ?? ''}.${input.sectionNumber} ${input.sectionTitle}`,
      `Compito della sezione: ${input.sectionIntent}`,
      input.needsCode
        ? 'Questa sezione richiede almeno un blocco di codice completo ed eseguibile, con il linguaggio dichiarato.'
        : '',
      input.needsFigure
        ? 'Questa sezione richiede una figura didattica. Se spiega un processo, una decisione o una ' +
          'sequenza, progetta esplicitamente un diagramma di flusso con passaggi, collegamenti e ' +
          'diramazioni; altrimenti indica il tipo visuale più adatto. Dichiarala con [IMMAGINE: tipo; ' +
          'contenuto; elementi e relazioni da mostrare] e aggiungi la didascalia, senza sostituire la ' +
          'figura con una descrizione ridondante nel testo corrente.'
        : '',
      '',
      // Le fonti servono a sapere che cosa è vero, non a essere citate: gli
      // indirizzi non arrivano nemmeno al modello, così non può inserirli.
      'Fonti da cui proviene il materiale, per tua informazione — non citarle nel testo:',
      ...(input.references.length > 0
        ? input.references.map((r) => `- ${r.title}${r.publisher ? ` — ${r.publisher}` : ''}`)
        : ['- Archivio del manoscritto']),
      '',
      'Estratti:',
      input.evidence || '(nessun estratto disponibile)',
      '',
      `Restituisci la sola sezione, aperta dal titolo «## ${input.number ?? ''}.${input.sectionNumber} ${input.sectionTitle}».`,
      'Ogni elemento di `gaps` deve essere una frase sintetica di massimo 300 caratteri.',
    ]
      .filter(Boolean)
      .join('\n'),
  deterministic: (input) => {
    const esistente = estraiSezioneMarkdown(input.existingContent, input.sectionTitle);
    const estratto = esistente || estrattoPerSezione(input.evidence, input.sectionTitle);
    const titolo = `## ${input.number ?? ''}.${input.sectionNumber} ${input.sectionTitle}`;
    if (estratto) {
      const corpo = estratto.replace(/^##\s+.*\r?\n?/, '').trim();
      return { contentMd: `${titolo}\n\n${corpo}`, gaps: [] };
    }
    return {
      contentMd: `${titolo}\n\nLe fonti disponibili non contengono ancora materiale sufficiente per sviluppare questa sezione senza introdurre informazioni non verificate.`,
      gaps: [`Mancano estratti sufficienti per la sezione «${input.sectionTitle}».`],
    };
  },
};

export interface ChapterApparatusInput extends ChapterDraftInput {
  objectives: string[];
  outline: string[];
  /** Il corpo già scritto: l'apparato deve parlare di quello, non di altro. */
  body: string;
}

export const chapterApparatusInputSchema = chapterDraftInputSchema.extend({
  objectives: z.array(z.string().max(300)).max(8),
  outline: z.array(z.string().max(200)).max(12),
  body: z.string(),
});

/**
 * Apparato di chiusura editoriale: best practice, errori comuni, riassunto e
 * punti chiave. È un manuale professionale, non un testo universitario.
 *
 * Riceve il corpo già scritto perché deve riassumere quello. Un riassunto
 * dedotto dalla scaletta riassumerebbe le intenzioni, non il capitolo.
 */
export const chapterApparatusAgent: AgentDefinition<ChapterApparatusInput, ChapterApparatusOutput> =
  {
    key: 'technical_writer',
    name: 'Chapter Apparatus',
    version: 1,
    promptVersion: 'v1',
    inputSchema: chapterApparatusInputSchema as unknown as z.ZodType<ChapterApparatusInput>,
    outputSchema: chapterApparatusOutputSchema,
    maxOutputTokens: 8000,
    system:
      'Componi l’apparato di chiusura di un capitolo di manuale tecnico professionale: best practice, ' +
      'errori comuni, riassunto e punti chiave. Ti basi soltanto sul capitolo che ti ' +
      'viene dato e sugli estratti: non introduci concetti che il capitolo non tratta. ' +
      'Non produrre quiz, domande di verifica, esercizi o laboratori: il lettore deve conoscere e ' +
      'usare lo strumento, non sostenere una valutazione. Non produrre alcuna bibliografia e non inserire URL: ' +
      'le fonti sono raccolte in un capitolo a parte. Rispondi in italiano.\n\n' +
      CONVENZIONI,

    buildPrompt: (input) =>
      [
        `Capitolo ${input.number ?? '—'}: ${input.title}`,
        `Obiettivi dichiarati: ${input.objectives.join(' · ')}`,
        '',
        input.direzione,
        '',
        'Capitolo scritto:',
        input.body.slice(0, 60_000),
        '',
        'Ogni elemento di `gaps` deve essere una frase sintetica di massimo 300 caratteri.',
      ]
        .filter(Boolean)
        .join('\n'),
    deterministic: (input) => {
      const punti = input.objectives.slice(0, 5);
      while (punti.length < 3) punti.push(`Rivedere il contenuto della sezione ${punti.length + 1}.`);
      const sintesi = input.body
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\[IMMAGINE:[^\]]+\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1400);
      return {
        bestPractices: punti.slice(0, 3).map((punto) => `Verifica operativamente questo obiettivo: ${punto}`),
        commonErrors: ['Procedere senza verificare i prerequisiti descritti nel capitolo.', 'Confondere il risultato atteso con il singolo passaggio operativo.'],
        summary: sintesi || `Il capitolo organizza i concetti essenziali relativi a ${input.title}.`,
        keyPoints: punti,
        gaps: [],
      };
    },
  };

function estraiSezioneMarkdown(markdown: string, title: string): string {
  const normalizza = (value: string) => value.toLowerCase().replace(/^\d+(?:\.\d+)*\s+/, '').replace(/[^a-z0-9à-ÿ]+/gi, ' ').trim();
  const cercato = normalizza(title);
  const matches = Array.from(markdown.matchAll(/^##\s+(.+)$/gm));
  const trovato = matches.find((match) => normalizza(match[1] ?? '') === cercato);
  if (!trovato || trovato.index === undefined) return '';
  const prossimo = matches.find((match) => (match.index ?? 0) > trovato.index!);
  return markdown.slice(trovato.index, prossimo?.index ?? markdown.length).trim();
}

function estrattoPerSezione(evidence: string, title: string): string {
  if (!evidence.trim()) return '';
  const termini = title.toLowerCase().split(/\W+/).filter((termine) => termine.length > 4);
  const blocchi = evidence.split(/\n\n+/).filter(Boolean);
  const pertinenti = blocchi.filter((blocco) => termini.some((termine) => blocco.toLowerCase().includes(termine)));
  return (pertinenti.length > 0 ? pertinenti : blocchi).slice(0, 4).join('\n\n').slice(0, 5000).trim();
}

// ===========================================================================
// Blog — piano degli angoli e stesura
// ===========================================================================

/**
 * Cosa significa ottimizzare per i motori **e** per i sistemi che rispondono.
 *
 * Le due cose non coincidono. Un motore di ricerca indicizza e ordina pagine;
 * un sistema che risponde estrae un passaggio e lo cita. Il primo premia
 * struttura e pertinenza, il secondo premia risposte brevi, autosufficienti e
 * verificabili, messe dove si trovano subito.
 *
 * Da qui le due regole che sembrano contraddirsi e non lo sono: la risposta
 * sintetica va **in apertura**, e il resto dell'articolo la argomenta invece di
 * ripeterla.
 */
const REGOLE_SEO =
  'Regole di ottimizzazione, da rispettare tutte:\n' +
  '- Apri con una risposta di due o tre frasi alla domanda del titolo, autosufficiente: ' +
  'chi legge solo quella deve avere già una risposta corretta.\n' +
  '- Un solo H1, poi H2 e H3 che ricalcano domande reali. Ogni sezione risponde a una domanda sola.\n' +
  '- La parola chiave principale compare nel titolo, nella prima sezione e in almeno un H2, ' +
  'sempre in una frase che si leggerebbe comunque così: nessuna ripetizione forzata.\n' +
  '- Definisci i termini tecnici alla prima occorrenza, in una frase che regga da sola se estratta.\n' +
  '- Preferisci elenchi e tabelle dove il contenuto è enumerabile: sono le porzioni che vengono citate.\n' +
  '- Chiudi con domande frequenti: domande vere, risposte brevi, nessuna che ripeta il corpo.\n' +
  '- Niente frasi di riempimento, niente «in questo articolo vedremo», niente superlativi.\n' +
  '- Non inventare dati, versioni, prezzi o limiti: se una cifra non è negli estratti, non si scrive.';

/**
 * Sceglie gli angoli degli articoli.
 *
 * Il piano esiste per una ragione economica prima che editoriale: dieci
 * articoli sbagliati costano dieci volte uno sbagliato. Si approva la scaletta,
 * poi si paga la scrittura.
 *
 * L'angolo è il campo che conta. Senza, dieci pezzi tratti dallo stesso manuale
 * finirebbero a dire le stesse cose e a competere fra loro sulle stesse ricerche.
 */
export const blogPlanAgent: AgentDefinition<BlogPlanInput, BlogPlanOutput> = {
  key: 'publishing',
  name: 'Blog Planner',
  version: 1,
  promptVersion: 'v1',
  inputSchema: blogPlanInputSchema,
  outputSchema: blogPlanOutputSchema,
  maxOutputTokens: 4000,
  system:
    'Progetti il piano editoriale di un blog tecnico a partire da un manuale già scritto. ' +
    'Ogni articolo ha un angolo distinto — un problema, un confronto, una procedura, un errore ' +
    'ricorrente, una decisione da prendere — e una domanda di ricerca diversa dagli altri. ' +
    'Non proponi riassunti di capitoli. Se il materiale non regge il numero richiesto, ne proponi ' +
    'meno e spieghi perché in «note»: un piano gonfiato produce articoli che si cannibalizzano. ' +
    'Rispondi in italiano.',

  buildPrompt: (input) =>
    [
      `Opera: ${input.projectTitle}${input.projectSubtitle ? ` — ${input.projectSubtitle}` : ''}`,
      `Lingua: ${input.language}`,
      '',
      input.direzione,
      '',
      'Indice dell’opera:',
      ...input.outline.map((voce) => `- ${voce}`),
      '',
      'Estratti disponibili:',
      input.evidence || '(nessun estratto)',
      '',
      `Proponi fino a ${input.count} articoli. Per ciascuno: titolo, angolo, parola chiave ` +
        'principale, chiavi secondarie e intento di ricerca.',
    ]
      .filter(Boolean)
      .join('\n'),

  deterministic: (input) => {
    const basi = input.outline.length > 0 ? input.outline : [input.projectTitle];
    const articles = Array.from(
      { length: Math.min(input.count, Math.max(1, basi.length)) },
      (_, indice) => {
        const voce = basi[indice % basi.length]!.replace(/^Capitolo\s+\S+\s+—\s+/i, '');
        return {
          title: `${voce}: guida pratica`,
          angle: `Una guida operativa basata sul manuale per applicare correttamente ${voce}, con decisioni ed errori da evitare.`,
          targetKeyword: voce.slice(0, 120),
          secondaryKeywords: [input.projectTitle.slice(0, 120)],
          searchIntent: 'procedurale',
        };
      },
    );
    return {
      articles,
      note:
        articles.length < input.count
          ? `Il manuale supporta ${articles.length} angoli distinti senza ripetizioni.`
          : '',
    };
  },
};

/** Scrive un articolo del piano. */
export const blogArticleAgent: AgentDefinition<BlogArticleInput, BlogArticleOutput> = {
  key: 'publishing',
  name: 'Blog Writer',
  version: 1,
  promptVersion: 'v1',
  inputSchema: blogArticleInputSchema as unknown as z.ZodType<BlogArticleInput>,
  outputSchema: blogArticleOutputSchema,
  maxOutputTokens: 8000,
  system:
    'Scrivi articoli tecnici per il blog di un editore, per un lettore professionista. ' +
    'Ti basi esclusivamente sugli estratti forniti: non aggiungi fatti, cifre o limiti che non ' +
    'compaiano nelle fonti, e non inventi collegamenti. Dove le fonti non bastano lo annoti in ' +
    '«gaps» e prosegui. Scrivi dalle 900 alle 1500 parole. Rispondi in italiano.\n\n' +
    REGOLE_SEO,

  buildPrompt: (input) =>
    [
      `Titolo di lavoro: ${input.title}`,
      `Angolo: ${input.angle}`,
      `Parola chiave principale: ${input.targetKeyword}`,
      input.secondaryKeywords.length > 0
        ? `Chiavi secondarie: ${input.secondaryKeywords.join(', ')}`
        : '',
      `Intento di ricerca: ${input.searchIntent}`,
      `Opera di riferimento: ${input.projectTitle}`,
      '',
      input.direzione,
      '',
      input.siblings.length > 0
        ? 'Altri articoli dello stesso piano — non invadere il loro campo, semmai rimandaci:'
        : '',
      ...input.siblings.map((titolo) => `- ${titolo}`),
      '',
      'Estratti su cui basarti:',
      input.evidence || '(nessun estratto)',
      '',
      'Restituisci l’articolo completo in Markdown, più i metadati richiesti.',
    ]
      .filter(Boolean)
      .join('\n'),

  deterministic: (input) => {
    const estratto = input.evidence.trim().slice(0, 12_000);
    const corpo = estratto || 'Il manuale approvato non contiene ancora estratti sufficienti.';
    const risposta = `${input.title} si affronta partendo dal flusso descritto nel manuale e verificando ogni passaggio sul contesto reale del progetto.`;
    return {
      contentMd: [
        `# ${input.title}`,
        '',
        risposta,
        '',
        `## ${input.targetKeyword || input.title}`,
        '',
        corpo,
        '',
        '## Punti da verificare',
        '',
        '- Verifica prerequisiti e dipendenze prima di applicare la procedura.',
        '- Confronta il risultato con gli obiettivi dichiarati nel manuale.',
        '',
        '## Domande frequenti',
        '',
        `### Da dove iniziare con ${input.targetKeyword || input.title}?`,
        '',
        'Dalla sezione pertinente del manuale approvato, procedendo nell’ordine delle dipendenze.',
      ].join('\n'),
      slug: slugForArticle(input.title),
      metaTitle: input.title.slice(0, 70),
      metaDescription: risposta.slice(0, 160),
      answerSummary: risposta.slice(0, 400),
      keyTakeaways: [
        'Partire dal materiale approvato e dalle sue dipendenze.',
        'Verificare il risultato prima di passare allo step successivo.',
      ],
      faq: [
        {
          question: `Da dove iniziare con ${input.targetKeyword || input.title}?`.slice(0, 300),
          answer: 'Dalla sezione pertinente del manuale approvato, seguendo l’ordine proposto.',
        },
      ],
      entities: [input.targetKeyword || input.projectTitle].filter(Boolean).slice(0, 20),
      internalLinkHints: input.siblings.slice(0, 10),
      gaps: estratto ? [] : ['Il manuale approvato non contiene estratti sufficienti.'],
    };
  },
};

function slugForArticle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

// ===========================================================================
// Corsi — piano e lezioni
// ===========================================================================

const FORMATI_CORSO: Record<string, string> = {
  autoapprendimento:
    'Formato autoapprendimento: il lettore è solo. Ogni lezione si regge da sé, gli esercizi ' +
    'hanno una soluzione verificabile senza docente, e ogni passaggio dice come accorgersi di ' +
    'aver sbagliato.',
  aula:
    'Formato aula: c’è un docente. Prevedi note per chi insegna, momenti di discussione, ' +
    'esercizi da svolgere insieme e i punti in cui conviene fermarsi a controllare la comprensione.',
  video:
    'Formato video: la lezione è un copione. Scrivi ciò che si dice e, fra parentesi quadre, ciò ' +
    'che si mostra a schermo. Frasi brevi, pronunciabili, senza incisi.',
};

const DURATE_CORSO = (minuti: number): string =>
  minuti <= 20
    ? `Lezione da ${minuti} minuti: un concetto solo, un esempio, una verifica. Nulla di più.`
    : minuti <= 60
      ? `Lezione da ${minuti} minuti: due o tre concetti collegati, un esercizio guidato, una verifica.`
      : `Lezione da ${minuti} minuti: trattazione estesa con più esercizi e una parte di ` +
        'applicazione autonoma. Prevedi una pausa a metà.';

/** Progetta il corso: esiti, prerequisiti e scaletta delle lezioni. */
export const coursePlanAgent: AgentDefinition<CoursePlanInput, CoursePlanOutput> = {
  key: 'teaching',
  name: 'Course Planner',
  version: 1,
  promptVersion: 'v1',
  inputSchema: coursePlanInputSchema,
  outputSchema: coursePlanOutputSchema,
  maxOutputTokens: 4000,
  system:
    'Progetti corsi tecnici. Parti dagli esiti — cosa saprà fare chi ha finito — e da lì ricavi ' +
    'le lezioni, non il contrario: una scaletta costruita sugli argomenti disponibili invece che ' +
    'sugli obiettivi produce un elenco, non un corso. Ogni lezione ha un compito distinto e ' +
    'poggia su quelle precedenti. Se il materiale non regge il numero di lezioni richiesto ne ' +
    'proponi meno e lo spieghi in «note». Rispondi in italiano.',

  buildPrompt: (input) =>
    [
      `Corso tratto da: ${input.projectTitle}`,
      `Argomento: ${input.topic}`,
      `Lezioni richieste: ${input.lessonCount}`,
      DURATE_CORSO(input.lessonMinutes),
      FORMATI_CORSO[input.format] ?? '',
      '',
      input.direzione,
      '',
      'Estratti disponibili:',
      input.evidence || '(nessun estratto)',
      '',
      'Restituisci titolo del corso, sintesi, prerequisiti, esiti di apprendimento e la scaletta ' +
        'delle lezioni con obiettivi.',
    ]
      .filter(Boolean)
      .join('\n'),
};

/** Scrive una lezione del corso. */
export const courseLessonAgent: AgentDefinition<CourseLessonInput, CourseLessonOutput> = {
  key: 'teaching',
  name: 'Course Lesson Writer',
  version: 1,
  promptVersion: 'v1',
  inputSchema: courseLessonInputSchema as unknown as z.ZodType<CourseLessonInput>,
  outputSchema: courseLessonOutputSchema,
  maxOutputTokens: 8000,
  system:
    'Scrivi lezioni di corsi tecnici. Ti basi esclusivamente sugli estratti forniti: non aggiungi ' +
    'fatti, cifre o limiti che non compaiano nelle fonti, e dove non bastano lo annoti in «gaps». ' +
    'Ogni lezione ha questa forma: obiettivi, spiegazione, esempio eseguibile, esercizio, verifica ' +
    'di comprensione, sintesi. La verifica ha risposte corrette indicate in fondo, non accanto ' +
    'alle domande. Rispondi in italiano.',

  buildPrompt: (input) =>
    [
      `Corso su: ${input.topic}`,
      `Lezione ${input.lessonNumber}: ${input.lessonTitle}`,
      `Compito della lezione: ${input.lessonIntent}`,
      input.lessonObjectives.length > 0 ? `Obiettivi: ${input.lessonObjectives.join(' · ')}` : '',
      DURATE_CORSO(input.lessonMinutes),
      FORMATI_CORSO[input.format] ?? '',
      '',
      input.direzione,
      '',
      'Scaletta completa del corso — non invadere le altre lezioni:',
      ...input.outline.map(
        (titolo, indice) =>
          `${indice + 1 === input.lessonNumber ? '→ ' : '  '}${indice + 1}. ${titolo}`,
      ),
      '',
      'Estratti su cui basarti:',
      input.evidence || '(nessun estratto)',
      '',
      'Restituisci la lezione completa in Markdown, a partire dal titolo di primo livello.',
    ]
      .filter(Boolean)
      .join('\n'),
};
