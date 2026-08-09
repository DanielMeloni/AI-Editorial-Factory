import type { DiagramOutput } from '@/lib/agents/schemas';

/**
 * Generatori di diagrammi tecnici.
 *
 * Tutti deterministici: la stessa descrizione produce sempre lo stesso
 * diagramma. Un modello visuale non viene mai coinvolto, perché su un DAG o su
 * una sequenza un arco inventato è un errore tecnico, non una licenza artistica.
 */

/** Identificatore Mermaid sicuro e stabile. */
export function safeId(name: string, index: number): string {
  const base = name.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '');
  return base.length > 0 ? `n${index}_${base.slice(0, 40)}` : `n${index}`;
}

function label(text: string): string {
  return `"${text.replace(/"/g, "'").replace(/[\r\n]+/g, ' ').slice(0, 80)}"`;
}

const CLASSI = [
  '  classDef sorgente fill:#e8f0fe,stroke:#4a6fa5,color:#16233d;',
  '  classDef modello fill:#d7f2ee,stroke:#2f7d72,color:#16233d;',
  '  classDef nota fill:#fff4e0,stroke:#c98a2b,color:#3d2e16;',
];

// ---------------------------------------------------------------------------
// Flusso di elaborazione
// ---------------------------------------------------------------------------

export interface FlowStep {
  label: string;
  /** Un passaggio condizionale disegna un rombo con due uscite. */
  condition?: { yes: string; no: string };
}

export function buildFlowDiagram(title: string, steps: FlowStep[]): DiagramOutput {
  const lines = ['flowchart TD'];
  const ids = steps.map((step, index) => safeId(step.label, index));

  steps.forEach((step, index) => {
    const id = ids[index]!;
    lines.push(step.condition ? `  ${id}{${label(step.label)}}` : `  ${id}[${label(step.label)}]`);
  });

  steps.forEach((step, index) => {
    const id = ids[index]!;
    const next = ids[index + 1];

    if (step.condition) {
      const siId = `${id}_si`;
      const noId = `${id}_no`;
      lines.push(
        `  ${siId}[${label(step.condition.yes)}]`,
        `  ${noId}[${label(step.condition.no)}]`,
        `  ${id} -->|sì| ${siId}`,
        `  ${id} -->|no| ${noId}`,
      );
      if (next) lines.push(`  ${siId} --> ${next}`, `  ${noId} --> ${next}`);
      return;
    }

    if (next) lines.push(`  ${id} --> ${next}`);
  });

  lines.push(...CLASSI);
  if (ids.length > 0) lines.push(`  class ${ids.join(',')} modello;`);

  return {
    mermaid: lines.join('\n'),
    title,
    caption: `Flusso in ${steps.length} passaggi: ${steps.map((s) => s.label).join(' → ')}.`,
    altText: `Diagramma di flusso verticale con ${steps.length} passaggi, da «${steps[0]?.label ?? ''}» a «${steps[steps.length - 1]?.label ?? ''}».`,
    nodeCount: lines.filter((l) => /^\s{2}n\d+/.test(l)).length,
    edgeCount: lines.filter((l) => l.includes('-->')).length,
  };
}

// ---------------------------------------------------------------------------
// Architettura a livelli
// ---------------------------------------------------------------------------

export interface ArchitectureLayer {
  name: string;
  components: string[];
}

export function buildArchitectureDiagram(
  title: string,
  layers: ArchitectureLayer[],
): DiagramOutput {
  const lines = ['flowchart TB'];
  const perLivello: string[][] = [];

  layers.forEach((layer, layerIndex) => {
    const ids = layer.components.map((component, i) => safeId(component, layerIndex * 100 + i));
    perLivello.push(ids);

    lines.push(`  subgraph L${layerIndex}[${label(layer.name)}]`, '    direction LR');
    layer.components.forEach((component, i) => {
      lines.push(`    ${ids[i]}[${label(component)}]`);
    });
    lines.push('  end');
  });

  // I livelli si collegano dall'alto verso il basso, uno all'altro.
  for (let i = 0; i < layers.length - 1; i += 1) {
    lines.push(`  L${i} --> L${i + 1}`);
  }

  lines.push(...CLASSI);
  const tutti = perLivello.flat();
  if (tutti.length > 0) lines.push(`  class ${tutti.join(',')} sorgente;`);

  return {
    mermaid: lines.join('\n'),
    title,
    caption: `Architettura su ${layers.length} livelli: ${layers.map((l) => l.name).join(' → ')}.`,
    altText: `Diagramma di architettura con ${layers.length} livelli sovrapposti e ${tutti.length} componenti.`,
    nodeCount: tutti.length,
    edgeCount: Math.max(layers.length - 1, 0),
  };
}

// ---------------------------------------------------------------------------
// Sequenza
// ---------------------------------------------------------------------------

export interface SequenceMessage {
  from: string;
  to: string;
  text: string;
  /** Una risposta è disegnata con la freccia tratteggiata. */
  isReply?: boolean;
}

export function buildSequenceDiagram(
  title: string,
  participants: string[],
  messages: SequenceMessage[],
): DiagramOutput {
  const lines = ['sequenceDiagram', '  autonumber'];
  const ids = new Map<string, string>();

  participants.forEach((participant, index) => {
    const id = safeId(participant, index);
    ids.set(participant, id);
    lines.push(`  participant ${id} as ${label(participant)}`);
  });

  for (const message of messages) {
    const from = ids.get(message.from) ?? safeId(message.from, 900);
    const to = ids.get(message.to) ?? safeId(message.to, 901);
    lines.push(`  ${from}${message.isReply ? '-->>' : '->>'}${to}: ${message.text.replace(/[\r\n]+/g, ' ')}`);
  }

  return {
    mermaid: lines.join('\n'),
    title,
    caption: `Sequenza fra ${participants.length} attori, ${messages.length} messaggi.`,
    altText: `Diagramma di sequenza con ${participants.length} partecipanti (${participants.join(', ')}) e ${messages.length} scambi.`,
    nodeCount: participants.length,
    edgeCount: messages.length,
  };
}

// ---------------------------------------------------------------------------
// Confronto fra alternative
// ---------------------------------------------------------------------------

export interface ComparisonRow {
  criterion: string;
  values: string[];
}

/**
 * Il confronto è reso come tabella Markdown, non come diagramma: una tabella si
 * legge meglio, è accessibile agli screen reader e resta ricercabile nel testo.
 */
export function buildComparisonTable(
  title: string,
  options: string[],
  rows: ComparisonRow[],
): { markdown: string; title: string; caption: string; altText: string } {
  const intestazione = `| Criterio | ${options.join(' | ')} |`;
  const separatore = `|---|${options.map(() => '---').join('|')}|`;
  const corpo = rows.map((row) => `| ${row.criterion} | ${row.values.join(' | ')} |`);

  return {
    markdown: [intestazione, separatore, ...corpo].join('\n'),
    title,
    caption: `Confronto fra ${options.length} alternative su ${rows.length} criteri.`,
    altText: `Tabella di confronto: ${options.join(', ')} valutate su ${rows.map((r) => r.criterion).join(', ')}.`,
  };
}

// ---------------------------------------------------------------------------
// Schema di tabella BigQuery
// ---------------------------------------------------------------------------

export interface TableColumn {
  name: string;
  type: string;
  mode?: 'NULLABLE' | 'REQUIRED' | 'REPEATED';
}

export function buildSchemaDiagram(
  tableName: string,
  columns: TableColumn[],
  options: { partitionBy?: string | null; clusterBy?: string[] } = {},
): DiagramOutput {
  const lines = ['classDiagram', `  class ${safeId(tableName, 0)} {`];

  for (const column of columns) {
    const suffisso =
      column.mode === 'REPEATED' ? '[]' : column.mode === 'REQUIRED' ? ' *' : '';
    lines.push(`    +${column.type}${suffisso} ${column.name}`);
  }
  lines.push('  }');

  const note: string[] = [];
  if (options.partitionBy) note.push(`partizionata per ${options.partitionBy}`);
  if (options.clusterBy?.length) note.push(`clusterizzata per ${options.clusterBy.join(', ')}`);
  if (note.length > 0) {
    lines.push(`  note for ${safeId(tableName, 0)} "${note.join('; ')}"`);
  }

  return {
    mermaid: lines.join('\n'),
    title: `Schema — ${tableName}`,
    caption: `${columns.length} colonne${note.length > 0 ? `, ${note.join('; ')}` : ''}.`,
    altText: `Schema della tabella ${tableName} con ${columns.length} colonne: ${columns.map((c) => `${c.name} di tipo ${c.type}`).join(', ')}.`,
    nodeCount: 1,
    edgeCount: 0,
  };
}
