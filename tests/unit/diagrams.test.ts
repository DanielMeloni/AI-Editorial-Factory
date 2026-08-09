import { describe, expect, it } from 'vitest';
import {
  buildArchitectureDiagram,
  buildComparisonTable,
  buildFlowDiagram,
  buildSchemaDiagram,
  buildSequenceDiagram,
  safeId,
} from '@/lib/visual/diagrams';

describe('identificatori Mermaid', () => {
  it('neutralizza i caratteri non ammessi', () => {
    expect(safeId('analytics.eventi-grezzi', 1)).toBe('n1_analytics_eventi_grezzi');
    expect(safeId('###', 2)).toBe('n2');
  });

  it('è stabile a parità di nome e indice', () => {
    expect(safeId('tabella', 3)).toBe(safeId('tabella', 3));
  });
});

describe('diagramma di flusso', () => {
  const diagramma = buildFlowDiagram('Esecuzione incrementale', [
    { label: 'Nuove righe disponibili' },
    { label: 'Tabella già esistente?', condition: { yes: 'Inserisci solo le nuove', no: 'Crea la tabella' } },
    { label: 'Aggiorna le asserzioni' },
  ]);

  it('produce Mermaid valido con i collegamenti attesi', () => {
    expect(diagramma.mermaid.startsWith('flowchart TD')).toBe(true);
    expect(diagramma.mermaid).toContain('-->');
    expect(diagramma.edgeCount).toBeGreaterThan(0);
  });

  it('disegna il nodo condizionale come rombo con due uscite etichettate', () => {
    expect(diagramma.mermaid).toContain('{');
    expect(diagramma.mermaid).toContain('|sì|');
    expect(diagramma.mermaid).toContain('|no|');
  });

  it('fornisce sempre un testo alternativo', () => {
    expect(diagramma.altText.length).toBeGreaterThan(20);
    expect(diagramma.altText).toContain('Nuove righe disponibili');
  });
});

describe('diagramma di architettura', () => {
  const diagramma = buildArchitectureDiagram('Pipeline analitica', [
    { name: 'Sorgenti', components: ['Eventi grezzi', 'Anagrafica utenti'] },
    { name: 'Trasformazione', components: ['Dataform'] },
    { name: 'Consumo', components: ['Dashboard', 'Esportazioni'] },
  ]);

  it('crea un sottografo per livello e li collega dall’alto in basso', () => {
    expect(diagramma.mermaid).toContain('subgraph L0');
    expect(diagramma.mermaid).toContain('subgraph L2');
    expect(diagramma.mermaid).toContain('L0 --> L1');
    expect(diagramma.mermaid).toContain('L1 --> L2');
  });

  it('conta i componenti, non i livelli', () => {
    expect(diagramma.nodeCount).toBe(5);
    expect(diagramma.edgeCount).toBe(2);
  });
});

describe('diagramma di sequenza', () => {
  const diagramma = buildSequenceDiagram(
    'Avvio di un audit',
    ['Utente', 'Applicazione', 'Motore dei workflow'],
    [
      { from: 'Utente', to: 'Applicazione', text: 'Avvia audit' },
      { from: 'Applicazione', to: 'Motore dei workflow', text: 'start()' },
      { from: 'Motore dei workflow', to: 'Applicazione', text: 'runId', isReply: true },
    ],
  );

  it('dichiara i partecipanti e numera i messaggi', () => {
    expect(diagramma.mermaid.startsWith('sequenceDiagram')).toBe(true);
    expect(diagramma.mermaid).toContain('autonumber');
    expect(diagramma.mermaid).toContain('participant');
  });

  it('distingue le risposte con la freccia tratteggiata', () => {
    expect(diagramma.mermaid).toContain('->>');
    expect(diagramma.mermaid).toContain('-->>');
  });

  it('conta partecipanti e messaggi', () => {
    expect(diagramma.nodeCount).toBe(3);
    expect(diagramma.edgeCount).toBe(3);
  });
});

describe('tabella di confronto', () => {
  const tabella = buildComparisonTable(
    'Tabella o vista',
    ['Tabella', 'Vista', 'Incrementale'],
    [
      { criterion: 'Costo di esecuzione', values: ['alto', 'nullo', 'basso'] },
      { criterion: 'Freschezza', values: ['alla build', 'sempre', 'alla build'] },
    ],
  );

  it('produce Markdown con intestazione, separatore e righe', () => {
    const righe = tabella.markdown.split('\n');
    expect(righe[0]).toBe('| Criterio | Tabella | Vista | Incrementale |');
    expect(righe[1]).toBe('|---|---|---|---|');
    expect(righe).toHaveLength(4);
  });

  it('è reso come tabella e non come immagine, per restare accessibile', () => {
    expect(tabella.markdown).not.toContain('<svg');
    expect(tabella.altText).toContain('Tabella, Vista, Incrementale');
  });
});

describe('schema di tabella', () => {
  const diagramma = buildSchemaDiagram(
    'analytics.eventi_giornalieri',
    [
      { name: 'event_date', type: 'DATE', mode: 'REQUIRED' },
      { name: 'eventi', type: 'INT64' },
      { name: 'tag', type: 'STRING', mode: 'REPEATED' },
    ],
    { partitionBy: 'event_date', clusterBy: ['tag'] },
  );

  it('elenca le colonne con tipo e modalità', () => {
    expect(diagramma.mermaid).toContain('+DATE * event_date');
    expect(diagramma.mermaid).toContain('+INT64 eventi');
    expect(diagramma.mermaid).toContain('+STRING[] tag');
  });

  it('annota partizionamento e clustering', () => {
    expect(diagramma.mermaid).toContain('partizionata per event_date');
    expect(diagramma.mermaid).toContain('clusterizzata per tag');
  });

  it('descrive lo schema nel testo alternativo', () => {
    expect(diagramma.altText).toContain('event_date di tipo DATE');
  });
});
