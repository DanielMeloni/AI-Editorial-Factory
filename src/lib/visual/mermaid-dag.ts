import type { DiagramOutput } from '@/lib/agents/schemas';

/**
 * Generazione deterministica del grafo delle dipendenze Dataform.
 *
 * Un DAG è una struttura esatta: si ricava dalle chiamate `ref()` presenti nel
 * codice. Affidarlo a un modello visuale significherebbe accettare che
 * inventi un arco. Qui il diagramma è corretto per costruzione — e se il codice
 * cambia, cambia con lui.
 */

export interface DagInput {
  /** Nome del modello descritto dal capitolo. */
  target: string;
  /** Tabelle da cui dipende, individuate con ref(). */
  dependencies: string[];
  /** Vero se il modello è incrementale: cambia la forma del nodo. */
  isIncremental?: boolean;
  title?: string;
}

/** Identificatore Mermaid sicuro, stabile rispetto allo stesso nome. */
export function toNodeId(name: string, index: number): string {
  const base = name.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '');
  return base.length > 0 ? `n${index}_${base.slice(0, 40)}` : `n${index}`;
}

/** Racchiude fra virgolette il testo di un'etichetta, neutralizzando i caratteri speciali. */
function label(text: string): string {
  return `"${text.replace(/"/g, "'").replace(/[\r\n]+/g, ' ').slice(0, 80)}"`;
}

export function buildDependencyDag(input: DagInput): DiagramOutput {
  const dependencies = [...new Set(input.dependencies)].sort();
  const targetId = toNodeId(input.target, 0);

  const lines: string[] = ['flowchart LR'];

  // Le sorgenti a sinistra, il modello a destra: il flusso dei dati si legge
  // nella direzione in cui si legge il testo.
  if (dependencies.length > 0) {
    lines.push('  subgraph sorgenti["Sorgenti dichiarate"]', '    direction TB');
    dependencies.forEach((dependency, index) => {
      lines.push(`    ${toNodeId(dependency, index + 1)}[${label(dependency)}]`);
    });
    lines.push('  end');
  }

  // Il doppio bordo distingue a colpo d'occhio un modello incrementale.
  lines.push(
    input.isIncremental
      ? `  ${targetId}[[${label(input.target)}]]`
      : `  ${targetId}[${label(input.target)}]`,
  );

  dependencies.forEach((dependency, index) => {
    lines.push(`  ${toNodeId(dependency, index + 1)} --> ${targetId}`);
  });

  if (dependencies.length === 0) {
    lines.push(`  origine["Nessuna dipendenza dichiarata"] -.-> ${targetId}`);
  }

  lines.push(
    '  classDef sorgente fill:#e8f0fe,stroke:#4a6fa5,color:#16233d;',
    '  classDef modello fill:#d7f2ee,stroke:#2f7d72,color:#16233d;',
  );
  if (dependencies.length > 0) {
    lines.push(
      `  class ${dependencies.map((d, i) => toNodeId(d, i + 1)).join(',')} sorgente;`,
    );
  }
  lines.push(`  class ${targetId} modello;`);

  const nodeCount = dependencies.length + 1;
  const edgeCount = Math.max(dependencies.length, 1);

  return {
    mermaid: lines.join('\n'),
    title: input.title ?? `Grafo delle dipendenze — ${input.target}`,
    caption:
      dependencies.length > 0
        ? `Il modello ${input.target} dipende da ${dependencies.length} sorgent${dependencies.length === 1 ? 'e' : 'i'}: ${dependencies.join(', ')}.`
        : `Il modello ${input.target} non dichiara dipendenze tramite ref().`,
    altText:
      dependencies.length > 0
        ? `Diagramma di flusso: ${dependencies.join(', ')} confluiscono nel modello ${input.target}${input.isIncremental ? ', dichiarato incrementale' : ''}.`
        : `Diagramma di flusso con il solo modello ${input.target}, privo di dipendenze dichiarate.`,
    nodeCount,
    edgeCount,
  };
}
