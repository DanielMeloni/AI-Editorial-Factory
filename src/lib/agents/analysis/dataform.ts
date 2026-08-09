/**
 * Analisi deterministica di codice Dataform, SQLX, SQL e JavaScript.
 *
 * Sono controlli verificabili e ripetibili, non opinioni di un modello: la
 * stessa sorgente produce sempre lo stesso esito. Il Technical Verifier li
 * esegue sempre; un provider AI, quando configurato, ne aggiunge altri ma non
 * può contraddirli.
 */

export interface CodeFinding {
  line: number;
  language: string | null;
  rule: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

const SQLX_LANGUAGES = new Set(['sqlx', 'sql']);
const JS_LANGUAGES = new Set(['js', 'javascript', 'ts', 'typescript']);

/** Estrae il blocco `config { … }` di un file SQLX, con bilanciamento delle graffe. */
export function extractConfigBlock(source: string): string | null {
  const start = source.search(/\bconfig\s*\{/);
  if (start === -1) return null;

  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** Legge una proprietà testuale dal blocco config: `type: "incremental"`. */
function readConfigString(config: string, key: string): string | null {
  const match = new RegExp(`\\b${key}\\s*:\\s*["']([^"']+)["']`).exec(config);
  return match?.[1] ?? null;
}

function hasConfigKey(config: string, key: string): boolean {
  return new RegExp(`\\b${key}\\s*:`).test(config);
}

/** Riferimenti `ref("...")` e `${ref('...')}` presenti nel codice. */
export function extractRefs(source: string): string[] {
  const refs = new Set<string>();
  for (const match of source.matchAll(/\bref\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    refs.add(match[1]!);
  }
  // Forma a due argomenti: ref("schema", "tabella")
  for (const match of source.matchAll(/\bref\s*\(\s*["'][^"']+["']\s*,\s*["']([^"']+)["']\s*\)/g)) {
    refs.add(match[1]!);
  }
  return [...refs];
}

/** Riferimenti scritti a mano invece che tramite `ref()`. */
function findHardcodedTables(source: string): string[] {
  const found = new Set<string>();
  // `progetto.dataset.tabella` fra backtick, tipico di BigQuery
  for (const match of source.matchAll(/`([a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)`/g)) {
    found.add(match[1]!);
  }
  return [...found];
}

export function analyzeCodeBlock(
  block: { language: string | null; content: string; line: number },
): CodeFinding[] {
  const language = block.language?.toLowerCase() ?? null;
  const source = block.content;
  const findings: CodeFinding[] = [];
  const at = (rule: string, severity: CodeFinding['severity'], message: string) =>
    findings.push({ line: block.line, language, rule, severity, message });

  if (language === null) {
    at(
      'blocco-senza-linguaggio',
      'low',
      'Blocco di codice senza linguaggio dichiarato: la colorazione sintattica non funziona e il tipo di codice resta ambiguo.',
    );
  }

  // -------------------------------------------------------------------------
  // SQLX e SQL
  // -------------------------------------------------------------------------
  if (language !== null && SQLX_LANGUAGES.has(language)) {
    const config = extractConfigBlock(source);
    const type = config ? readConfigString(config, 'type') : null;

    if (language === 'sqlx' && !config) {
      at(
        'sqlx-senza-config',
        'medium',
        'Blocco SQLX senza `config { … }`: Dataform non saprebbe se creare una tabella, una vista o una dichiarazione.',
      );
    }

    if (type === 'incremental') {
      // La condizione incrementale è ciò che distingue una tabella incrementale
      // da una ricostruita per intero a ogni esecuzione.
      const hasIncrementalGuard =
        /\bincremental\s*\(\s*\)/.test(source) || /\bself\s*\(\s*\)/.test(source);

      if (!hasIncrementalGuard) {
        at(
          'incrementale-senza-condizione',
          'high',
          'Tabella dichiarata `incremental` senza `when(incremental(), …)` né riferimento a `self()`: ' +
            'a ogni esecuzione verrebbe rielaborato l’intero storico, annullando il vantaggio di costo.',
        );
      }

      if (config && !hasConfigKey(config, 'uniqueKey')) {
        at(
          'incrementale-senza-unique-key',
          'medium',
          'Tabella incrementale senza `uniqueKey`: le righe aggiornate verrebbero duplicate invece di essere sostituite.',
        );
      }

      if (config && !hasConfigKey(config, 'bigquery')) {
        at(
          'incrementale-senza-partizionamento',
          'low',
          'Nessuna configurazione `bigquery` con `partitionBy`: su tabelle di grandi dimensioni il costo di scansione resta alto.',
        );
      }
    }

    if (/\bselect\s+\*/i.test(source)) {
      at(
        'select-asterisco',
        'medium',
        '`SELECT *` rende lo schema dipendente dalla sorgente: una colonna aggiunta a monte cambia silenziosamente l’output.',
      );
    }

    for (const table of findHardcodedTables(source)) {
      // Le dichiarazioni citano legittimamente la tabella fisica.
      if (type === 'declaration') continue;
      at(
        'riferimento-non-dichiarato',
        'high',
        `La tabella \`${table}\` è indicata direttamente: usando \`ref()\` entrerebbe nel grafo delle dipendenze e verrebbe ordinata correttamente.`,
      );
    }

    if (/\bdelete\s+from\b/i.test(source) && !/\bwhere\b/i.test(source)) {
      at('delete-senza-where', 'critical', '`DELETE` senza `WHERE`: cancellerebbe l’intera tabella.');
    }
  }

  // -------------------------------------------------------------------------
  // JavaScript
  // -------------------------------------------------------------------------
  if (language !== null && JS_LANGUAGES.has(language)) {
    if (/\bvar\s+/.test(source)) {
      at('var-obsoleto', 'low', '`var` ha ambito di funzione: preferire `const` o `let`.');
    }
    if (/[^=!<>]==[^=]/.test(source)) {
      at(
        'confronto-debole',
        'low',
        'Confronto con `==`: la conversione implicita di tipo produce risultati sorprendenti. Usare `===`.',
      );
    }
  }

  return findings;
}

/** Analizza tutti i blocchi e restituisce anche l'elenco delle dipendenze. */
export function analyzeCodeBlocks(
  blocks: { language: string | null; content: string; line: number }[],
): { findings: CodeFinding[]; refs: string[] } {
  const findings: CodeFinding[] = [];
  const refs = new Set<string>();

  for (const block of blocks) {
    findings.push(...analyzeCodeBlock(block));
    for (const ref of extractRefs(block.content)) refs.add(ref);
  }

  return { findings, refs: [...refs].sort() };
}
