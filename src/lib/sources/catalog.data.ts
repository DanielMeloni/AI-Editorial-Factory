/**
 * Dati dell'indice curato delle fonti ufficiali.
 *
 * Questo file è generato e ricucito: `npm run sources:refresh` aggiunge le
 * pagine nuove trovate nelle sitemap ufficiali e **conserva i termini scritti a
 * mano**. I `topics` sono la parte curata — sono il ponte fra un manuale in
 * italiano e una documentazione in inglese — e non vengono mai sovrascritti da
 * una generazione automatica.
 *
 * Regole per chi aggiunge una voce a mano:
 *  - solo URL `https` su un dominio di `OFFICIAL_DOMAINS`;
 *  - `topics` in italiano **e** in inglese, al singolare e al plurale quando la
 *    forma cambia il termine («tabella», «tabelle»);
 *  - niente termini generici come «dati» o «google»: alzano il rumore e non
 *    distinguono una pagina dall'altra.
 */

import type { CatalogEntry } from './catalog';

/** Data dell'ultimo allineamento dell'indice. */
export const CATALOG_GENERATED_AT = '2026-08-15';

export const CATALOG_ENTRIES: readonly CatalogEntry[] = [
  // -------------------------------------------------------------------------
  // Dataform · fondamenti
  // -------------------------------------------------------------------------
  {
    url: 'https://docs.cloud.google.com/dataform/docs/overview',
    title: 'Panoramica di Dataform',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'dataform', 'panoramica', 'overview', 'introduzione', 'introduction',
      'concetti', 'concepts', 'repository', 'workspace', 'compilazione', 'compilation',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/quickstart-create-workflow',
    title: 'Guida rapida: creare ed eseguire un workflow',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'guida', 'rapida', 'quickstart', 'primo', 'workflow', 'creare', 'create',
      'eseguire', 'esecuzione', 'run', 'tutorial',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/sql-workflows',
    title: 'Panoramica dei workflow',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'workflow', 'flusso', 'pipeline', 'sql', 'sqlx', 'grafo', 'graph', 'dag',
      'esecuzione', 'execution', 'compilazione', 'compilation', 'azione', 'action',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/create-repository',
    title: 'Creare un repository',
    product: 'dataform',
    section: 'Guide',
    topics: ['repository', 'creare', 'create', 'git', 'progetto', 'project', 'collegare', 'connect'],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/manage-repository',
    title: 'Gestire un repository',
    product: 'dataform',
    section: 'Guide',
    topics: ['repository', 'gestire', 'manage', 'git', 'branch', 'remoto', 'remote', 'sincronizzare'],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/create-workspace',
    title: 'Creare un workspace di sviluppo',
    product: 'dataform',
    section: 'Guide',
    topics: ['workspace', 'sviluppo', 'development', 'creare', 'create', 'branch', 'commit'],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/organize-code-assets',
    title: 'Organizzare gli asset di codice',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'organizzare', 'organize', 'struttura', 'structure', 'cartelle', 'directory',
      'definitions', 'includes', 'convenzioni', 'naming', 'nomenclatura',
    ],
  },

  // -------------------------------------------------------------------------
  // Dataform · modellazione
  // -------------------------------------------------------------------------
  {
    url: 'https://docs.cloud.google.com/dataform/docs/create-tables',
    title: 'Creare tabelle',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'tabella', 'tabelle', 'table', 'tables', 'incrementale', 'incrementali', 'incremental',
      'vista', 'viste', 'view', 'views', 'materializzata', 'materialized',
      'config', 'type', 'uniquekey', 'unique_key', 'partitionby', 'partizionamento',
      'when', 'self', 'ricostruzione', 'fullrefresh', 'aggiornamento', 'merge',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/declare-source',
    title: 'Dichiarare una sorgente dati',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'dichiarazione', 'dichiarare', 'declaration', 'declare', 'sorgente', 'sorgenti',
      'source', 'sources', 'esterna', 'external', 'ref', 'grezza', 'raw',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/dependencies',
    title: 'Impostare le dipendenze',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'dipendenza', 'dipendenze', 'dependency', 'dependencies', 'ref', 'resolve',
      'grafo', 'graph', 'dag', 'ordine', 'order', 'esecuzione', 'tags', 'tag',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/assertions',
    title: 'Verificare la qualità dei dati',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'assertion', 'assertions', 'asserzione', 'asserzioni', 'qualità', 'quality',
      'test', 'controllo', 'validazione', 'validation', 'nonnull', 'uniquekey',
      'rowconditions', 'duplicati', 'duplicates',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/javascript-in-dataform',
    title: 'Usare JavaScript in Dataform',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'javascript', 'js', 'funzione', 'funzioni', 'function', 'includes', 'costante',
      'variabile', 'variabili', 'variable', 'ciclo', 'loop', 'template', 'riuso', 'reuse',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/configure-compilation',
    title: 'Configurare le compilazioni',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'compilazione', 'compilation', 'configurazione', 'configurare', 'configure',
      'workflow_settings', 'dataform.json', 'variabili', 'vars', 'ambiente', 'environment',
      'schema', 'suffisso', 'suffix', 'prefisso', 'prefix',
    ],
  },

  // -------------------------------------------------------------------------
  // Dataform · esecuzione
  // -------------------------------------------------------------------------
  {
    url: 'https://docs.cloud.google.com/dataform/docs/schedule-runs',
    title: 'Pianificare le esecuzioni',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'pianificare', 'pianificazione', 'schedule', 'scheduling', 'cron', 'periodica',
      'ricorrente', 'workflow_config', 'release', 'automatica', 'scheduler', 'composer',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/trigger-execution',
    title: 'Avviare manualmente le esecuzioni',
    product: 'dataform',
    section: 'Guide',
    topics: ['avviare', 'trigger', 'manuale', 'manual', 'esecuzione', 'execution', 'invocazione'],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/managing-code-lifecycle',
    title: 'Buone pratiche per il ciclo di vita del workflow',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'ciclo', 'vita', 'lifecycle', 'buone', 'pratiche', 'best', 'practices',
      'ambiente', 'ambienti', 'environment', 'produzione', 'production', 'staging',
      'promozione', 'rilascio', 'release', 'versionamento',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/authentication',
    title: 'Autenticarsi a Dataform',
    product: 'dataform',
    section: 'Riferimento',
    topics: [
      'autenticazione', 'authentication', 'credenziali', 'credentials', 'iam',
      'permessi', 'permission', 'ruolo', 'role', 'service', 'account', 'accesso',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/audit-logging',
    title: 'Audit logging di Dataform',
    product: 'dataform',
    section: 'Riferimento',
    topics: ['audit', 'log', 'logging', 'tracciamento', 'registro', 'cloud', 'monitoraggio'],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/troubleshooting',
    title: 'Risoluzione dei problemi di Dataform',
    product: 'dataform',
    section: 'Guide',
    topics: [
      'errore', 'errori', 'error', 'problema', 'problemi', 'troubleshooting',
      'risoluzione', 'fallimento', 'failure', 'diagnosi', 'debug',
    ],
  },

  // -------------------------------------------------------------------------
  // Dataform · costi, limiti, riferimento
  // -------------------------------------------------------------------------
  {
    url: 'https://docs.cloud.google.com/dataform/pricing',
    title: 'Prezzi di Dataform',
    product: 'dataform',
    section: 'Risorse',
    topics: [
      'prezzo', 'prezzi', 'pricing', 'costo', 'costi', 'cost', 'tariffa', 'tariffe',
      'fatturazione', 'billing', 'addebito', 'gratuito', 'free', 'spesa',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/billing-questions',
    title: 'Domande sulla fatturazione di Dataform',
    product: 'dataform',
    section: 'Risorse',
    topics: ['fatturazione', 'billing', 'costo', 'costi', 'addebito', 'fattura', 'spesa'],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/quotas',
    title: 'Quote e limiti di Dataform',
    product: 'dataform',
    section: 'Risorse',
    topics: [
      'quota', 'quote', 'quotas', 'limite', 'limiti', 'limit', 'limits', 'massimo',
      'maximum', 'soglia', 'threshold', 'restrizione', 'vincolo', 'azione', 'azioni',
      'action', 'actions', 'numero', 'supporta', 'supportato',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/locations',
    title: 'Località disponibili per Dataform',
    product: 'dataform',
    section: 'Risorse',
    topics: ['località', 'location', 'locations', 'regione', 'regioni', 'region', 'area', 'residenza'],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/reference/dataform-core-reference',
    title: 'Riferimento di Dataform core',
    product: 'dataform',
    section: 'Riferimento',
    topics: [
      'riferimento', 'reference', 'sintassi', 'syntax', 'api', 'config', 'publish',
      'declare', 'operate', 'assert', 'ref', 'self', 'resolve', 'when', 'incremental',
      'preops', 'postops', 'metodo', 'metodi', 'parametro', 'parametri', 'opzione',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/reference/sample-scripts',
    title: 'Script di esempio di Dataform core',
    product: 'dataform',
    section: 'Riferimento',
    topics: ['esempio', 'esempi', 'example', 'sample', 'script', 'ricetta', 'snippet', 'modello'],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/reference/dataform-cli-reference',
    title: 'Riferimento della CLI di Dataform',
    product: 'dataform',
    section: 'Riferimento',
    topics: ['cli', 'terminale', 'terminal', 'comando', 'comandi', 'command', 'npx', 'locale'],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/reference/libraries',
    title: 'Librerie client di Dataform',
    product: 'dataform',
    section: 'Riferimento',
    topics: ['libreria', 'librerie', 'library', 'libraries', 'client', 'sdk', 'python', 'java'],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/reference/rest',
    title: 'API REST di Dataform',
    product: 'dataform',
    section: 'Riferimento',
    topics: ['api', 'rest', 'endpoint', 'http', 'richiesta', 'request', 'risorsa', 'automazione'],
  },
  {
    url: 'https://docs.cloud.google.com/dataform/docs/release-notes',
    title: 'Note di rilascio di Dataform',
    product: 'dataform',
    section: 'Risorse',
    topics: ['note', 'rilascio', 'release', 'notes', 'novità', 'changelog', 'versione', 'deprecato'],
  },

  // -------------------------------------------------------------------------
  // BigQuery · partizionamento e clustering
  // -------------------------------------------------------------------------
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/partitioned-tables',
    title: 'Introduzione alle tabelle partizionate',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'partizione', 'partizioni', 'partizionamento', 'partizionata', 'partizionate',
      'partition', 'partitioned', 'partitionby', 'partitioning', 'ingestion', 'scansione',
      'scan', 'time', 'giornaliera', 'daily', 'colonna',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/querying-partitioned-tables',
    title: 'Interrogare tabelle partizionate',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'partizione', 'partizionata', 'partition', 'query', 'interrogare', 'filtro',
      'filter', 'pruning', 'potatura', 'scansione', 'costo',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/clustered-tables',
    title: 'Introduzione alle tabelle in cluster',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'cluster', 'clustering', 'clusterizzata', 'clustered', 'clusterby', 'ordinamento',
      'sorting', 'colonna', 'colonne', 'prestazioni', 'performance',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/querying-clustered-tables',
    title: 'Interrogare tabelle in cluster',
    product: 'bigquery',
    section: 'Guide',
    topics: ['cluster', 'clustering', 'clustered', 'query', 'interrogare', 'filtro', 'prestazioni'],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/manage-partition-cluster-recommendations',
    title: 'Gestire i suggerimenti su partizionamento e clustering',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'suggerimento', 'suggerimenti', 'recommendation', 'recommendations', 'partizionamento',
      'clustering', 'ottimizzazione', 'consiglio', 'advisor',
    ],
  },

  // -------------------------------------------------------------------------
  // BigQuery · prestazioni e costi
  // -------------------------------------------------------------------------
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/best-practices-costs',
    title: 'Stimare e controllare i costi in BigQuery',
    product: 'bigquery',
    section: 'Buone pratiche',
    topics: [
      'costo', 'costi', 'cost', 'costs', 'prezzo', 'prezzi', 'pricing', 'stima', 'estimate',
      'controllo', 'control', 'budget', 'byte', 'scansionati', 'dryrun', 'fatturazione',
      'risparmio', 'ridurre', 'riduce', 'economico',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/best-practices-performance-compute',
    title: 'Ottimizzare il calcolo delle query',
    product: 'bigquery',
    section: 'Buone pratiche',
    topics: [
      'prestazioni', 'performance', 'ottimizzare', 'ottimizzazione', 'optimize',
      'query', 'calcolo', 'compute', 'lento', 'veloce', 'slot', 'join', 'shuffle',
      'buone', 'pratiche', 'best', 'practices',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/best-practices-storage',
    title: 'Ottimizzare lo storage per le prestazioni delle query',
    product: 'bigquery',
    section: 'Buone pratiche',
    topics: [
      'storage', 'archiviazione', 'ottimizzare', 'prestazioni', 'performance',
      'compressione', 'denormalizzazione', 'nested', 'annidato', 'colonnare',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/quotas',
    title: 'Quote e limiti di BigQuery',
    product: 'bigquery',
    section: 'Risorse',
    topics: [
      'quota', 'quote', 'quotas', 'limite', 'limiti', 'limit', 'limits', 'massimo',
      'maximum', 'soglia', 'concorrenza', 'concurrent', 'dimensione', 'size',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/troubleshoot-quotas',
    title: 'Risolvere gli errori di quota e di limite',
    product: 'bigquery',
    section: 'Risorse',
    topics: ['quota', 'limite', 'errore', 'error', 'superato', 'exceeded', 'troubleshooting', 'ritentare'],
  },

  // -------------------------------------------------------------------------
  // BigQuery · viste e DML
  // -------------------------------------------------------------------------
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/views-intro',
    title: 'Introduzione alle viste logiche',
    product: 'bigquery',
    section: 'Guide',
    topics: ['vista', 'viste', 'view', 'views', 'logica', 'logical', 'astrazione', 'select'],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/materialized-views-intro',
    title: 'Introduzione alle viste materializzate',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'vista', 'viste', 'materializzata', 'materializzate', 'materialized', 'view',
      'cache', 'precalcolo', 'aggiornamento', 'refresh', 'incrementale',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/materialized-views-create',
    title: 'Creare viste materializzate',
    product: 'bigquery',
    section: 'Guide',
    topics: ['vista', 'materializzata', 'materialized', 'creare', 'create', 'sintassi', 'ddl'],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/materialized-views-use',
    title: 'Usare le viste materializzate',
    product: 'bigquery',
    section: 'Guide',
    topics: ['vista', 'materializzata', 'materialized', 'usare', 'query', 'riscrittura', 'rewrite'],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/data-manipulation-language',
    title: 'Trasformare i dati con il DML',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'dml', 'insert', 'update', 'delete', 'merge', 'trasformare', 'modificare',
      'aggiornare', 'cancellare', 'eliminare', 'upsert',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/dml-syntax',
    title: 'Sintassi delle istruzioni DML in GoogleSQL',
    product: 'bigquery',
    section: 'Riferimento',
    topics: [
      'dml', 'sintassi', 'syntax', 'insert', 'update', 'delete', 'merge', 'truncate',
      'where', 'googlesql', 'riferimento', 'reference', 'istruzione',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/continuous-queries-introduction',
    title: 'Introduzione alle query continue',
    product: 'bigquery',
    section: 'Guide',
    topics: ['continua', 'continue', 'continuous', 'streaming', 'tempo', 'reale', 'realtime', 'flusso'],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/biglake-iceberg-tables-in-bigquery',
    title: 'Tabelle gestite Apache Iceberg',
    product: 'bigquery',
    section: 'Guide',
    topics: ['iceberg', 'biglake', 'apache', 'formato', 'aperto', 'open', 'tabella', 'gestita'],
  },

  // -------------------------------------------------------------------------
  // BigQuery · fondamenti ed esecuzione
  // -------------------------------------------------------------------------
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/introduction',
    title: 'Panoramica di BigQuery',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'bigquery', 'panoramica', 'overview', 'introduzione', 'introduction',
      'architettura', 'architecture', 'serverless', 'warehouse', 'analitico',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/running-queries',
    title: 'Eseguire una query',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'query', 'eseguire', 'esecuzione', 'interattiva', 'interactive', 'batch',
      'lotto', 'job', 'risultato', 'result', 'cache',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/slots',
    title: 'Comprendere gli slot',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'slot', 'slots', 'capacita', 'capacity', 'calcolo', 'compute', 'concorrenza',
      'concurrency', 'prestazioni', 'performance', 'coda', 'queue',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/editions-intro',
    title: 'Edizioni di BigQuery',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'edizione', 'edizioni', 'edition', 'editions', 'standard', 'enterprise',
      'piano', 'prezzo', 'prezzi', 'pricing', 'costo', 'costi', 'ondemand',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/reservations-workload-management',
    title: 'Prenotazioni e gestione del carico di lavoro',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'prenotazione', 'prenotazioni', 'reservation', 'reservations', 'carico',
      'workload', 'slot', 'assegnazione', 'assignment', 'impegno', 'commitment',
    ],
  },

  // -------------------------------------------------------------------------
  // BigQuery · riferimento GoogleSQL
  // -------------------------------------------------------------------------
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/query-syntax',
    title: 'Sintassi delle query in GoogleSQL',
    product: 'bigquery',
    section: 'Riferimento',
    topics: [
      'sintassi', 'syntax', 'select', 'from', 'where', 'join', 'group', 'having',
      'order', 'limit', 'with', 'unnest', 'googlesql', 'riferimento', 'reference',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/pipe-syntax',
    title: 'Sintassi pipe di GoogleSQL',
    product: 'bigquery',
    section: 'Riferimento',
    topics: ['pipe', 'sintassi', 'syntax', 'concatenamento', 'googlesql', 'operatore'],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/aggregate_functions',
    title: 'Funzioni di aggregazione',
    product: 'bigquery',
    section: 'Riferimento',
    topics: [
      'aggregazione', 'aggregate', 'funzione', 'funzioni', 'function', 'count',
      'sum', 'avg', 'min', 'max', 'array_agg', 'string_agg', 'distinct',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/window-function-calls',
    title: 'Chiamate a funzioni finestra',
    product: 'bigquery',
    section: 'Riferimento',
    topics: [
      'finestra', 'window', 'over', 'partition', 'rank', 'row_number', 'lag',
      'lead', 'analitica', 'analytic', 'funzione', 'ordinamento',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/reference/standard-sql/functions-all',
    title: 'Elenco alfabetico delle funzioni',
    product: 'bigquery',
    section: 'Riferimento',
    topics: [
      'funzione', 'funzioni', 'function', 'functions', 'elenco', 'alfabetico',
      'catalogo', 'riferimento', 'reference', 'stringa', 'string', 'timestamp',
    ],
  },

  // -------------------------------------------------------------------------
  // BigQuery · accesso e sicurezza
  // -------------------------------------------------------------------------
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/access-control-intro',
    title: 'Sicurezza e controlli di accesso in BigQuery',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'sicurezza', 'security', 'accesso', 'access', 'controllo', 'protezione',
      'cifratura', 'encryption', 'riservatezza',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/access-control',
    title: 'Ruoli e permessi IAM di BigQuery',
    product: 'bigquery',
    section: 'Riferimento',
    topics: [
      'iam', 'ruolo', 'ruoli', 'role', 'roles', 'permesso', 'permessi', 'permission',
      'concedere', 'grant', 'viewer', 'editor', 'admin', 'account',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/column-level-security',
    title: 'Controllo di accesso a livello di colonna',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'colonna', 'colonne', 'column', 'livello', 'level', 'mascheramento', 'masking',
      'tag', 'policy', 'riservato', 'sensibile', 'sensitive',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/troubleshoot-access-control',
    title: 'Risolvere i problemi di permessi',
    product: 'bigquery',
    section: 'Risorse',
    topics: ['permesso', 'permessi', 'negato', 'denied', 'errore', 'accesso', 'troubleshooting'],
  },

  // -------------------------------------------------------------------------
  // BigQuery · dati in ingresso e in uscita
  // -------------------------------------------------------------------------
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/loading-data',
    title: 'Introduzione al caricamento dei dati',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'caricamento', 'caricare', 'load', 'loading', 'ingestione', 'ingestion',
      'importare', 'import', 'formato', 'csv', 'json', 'parquet', 'avro',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/batch-loading-data',
    title: 'Caricamento a lotti',
    product: 'bigquery',
    section: 'Guide',
    topics: ['lotto', 'batch', 'caricamento', 'load', 'job', 'schema', 'autodetect'],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/streaming-data-into-bigquery',
    // La pagina è stata riorganizzata: l'indirizzo storico porta ora alla
    // Storage Write API. Il titolo è quello letto dalla pagina, non quello atteso.
    title: 'Storage Write API: inserire dati in streaming',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'streaming', 'flusso', 'insertall', 'tempo', 'reale', 'realtime', 'buffer',
      'riga', 'righe', 'write', 'deduplicazione', 'deduplication',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/exporting-data',
    title: 'Esportare i dati su Cloud Storage',
    product: 'bigquery',
    section: 'Guide',
    topics: ['esportare', 'esportazione', 'export', 'estrazione', 'extract', 'storage', 'formato'],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/scheduling-queries',
    title: 'Pianificare le query',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'pianificare', 'pianificazione', 'schedule', 'scheduled', 'ricorrente',
      'periodica', 'cron', 'automatica',
    ],
  },
  {
    url: 'https://docs.cloud.google.com/bigquery/docs/dts-introduction',
    title: 'BigQuery Data Transfer Service',
    product: 'bigquery',
    section: 'Guide',
    topics: [
      'trasferimento', 'transfer', 'servizio', 'service', 'connettore', 'connector',
      'sorgente', 'automatico', 'ricorrente',
    ],
  },
];
