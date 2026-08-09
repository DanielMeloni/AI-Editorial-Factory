import { describe, expect, it } from 'vitest';
import {
  deriveArticle,
  deriveLesson,
  extractKeywords,
  readingTime,
  splitSections,
} from '@/lib/publish/derivations';

const CAPITOLO_COMPLETO = `# Incremental Tables

Le tabelle incrementali elaborano solo le righe nuove invece di ricostruire
l'intero storico a ogni esecuzione.

## Obiettivi

- Riconoscere quando conviene una tabella incrementale
- Scrivere la condizione incrementale corretta
- Verificare il risultato con le asserzioni

## Prerequisiti

- Conoscere le tabelle Dataform
- Saper leggere una query BigQuery

## Spiegazione

Una tabella incrementale mantiene lo stato precedente e vi aggiunge le righe nuove.

## Esempio

Ecco la configurazione minima.

\`\`\`sqlx
config { type: "incremental", uniqueKey: ["id"] }
select 1
\`\`\`

## Esercizi

1. Trasforma una tabella esistente in incrementale
2. Aggiungi il partizionamento
3. Misura la differenza di costo

## Riepilogo

Le tabelle incrementali riducono il costo di elaborazione.
`;

const CAPITOLO_SPOGLIO = `# Titolo secco

Testo breve.

## Una sezione

Contenuto.
`;

describe('divisione in sezioni', () => {
  it('individua le sezioni di secondo livello', () => {
    const sezioni = splitSections(CAPITOLO_COMPLETO);
    expect(sezioni.map((s) => s.heading)).toEqual([
      'Obiettivi', 'Prerequisiti', 'Spiegazione', 'Esempio', 'Esercizi', 'Riepilogo',
    ]);
  });

  it('non scambia per titolo un commento dentro un blocco di codice', () => {
    const sezioni = splitSections('## Vera\n\n```sh\n## finta\n```\n\n## Altra vera\n');
    expect(sezioni.map((s) => s.heading)).toEqual(['Vera', 'Altra vera']);
  });
});

describe('derivazione della lezione', () => {
  const lezione = deriveLesson(CAPITOLO_COMPLETO, {
    title: 'Incremental Tables',
    chapterLabel: 'Capitolo 11',
  });

  it('estrae gli obiettivi alla lettera dal capitolo', () => {
    expect(lezione.objectives).toEqual([
      'Riconoscere quando conviene una tabella incrementale',
      'Scrivere la condizione incrementale corretta',
      'Verificare il risultato con le asserzioni',
    ]);
  });

  it('estrae i prerequisiti', () => {
    expect(lezione.prerequisites).toHaveLength(2);
    expect(lezione.prerequisites[0]).toContain('tabelle Dataform');
  });

  it('porta i blocchi di codice nella dimostrazione, invariati', () => {
    expect(lezione.demonstration.code).toHaveLength(1);
    expect(lezione.demonstration.code[0]!.language).toBe('sqlx');
    expect(lezione.demonstration.code[0]!.content).toContain('uniqueKey');
  });

  it('ricava il laboratorio dagli esercizi del capitolo', () => {
    expect(lezione.lab.steps).toHaveLength(3);
    expect(lezione.lab.steps[0]).toContain('Trasforma');
  });

  it('estrae il riepilogo', () => {
    expect(lezione.summary).toContain('riducono il costo');
  });

  it('compone il titolo con l’etichetta del capitolo', () => {
    expect(lezione.title).toBe('Capitolo 11 — Incremental Tables');
  });

  /**
   * Il punto che conta: ciò che manca non viene inventato. Un obiettivo
   * verosimile ma falso supera una revisione distratta; un obiettivo assente no.
   */
  it('non inventa le opzioni del quiz e le dichiara da scrivere', () => {
    expect(lezione.quiz.length).toBeGreaterThan(0);
    for (const domanda of lezione.quiz) {
      expect(domanda.options).toEqual([]);
      expect(domanda.answerIndex).toBeNull();
      expect(domanda.needsAuthoring).toBe(true);
    }
    expect(lezione.pendingAuthoring.join(' ')).toMatch(/Quiz/);
  });

  it('lascia vuoto il compito finale e lo dichiara', () => {
    expect(lezione.finalAssignment).toBe('');
    expect(lezione.pendingAuthoring.join(' ')).toMatch(/Compito finale/);
  });

  it('su un capitolo spoglio elenca tutto ciò che manca', () => {
    const spoglia = deriveLesson(CAPITOLO_SPOGLIO, { title: 'Titolo secco', chapterLabel: null });

    expect(spoglia.objectives).toEqual([]);
    expect(spoglia.prerequisites).toEqual([]);
    expect(spoglia.lab.steps).toEqual([]);

    const pendenze = spoglia.pendingAuthoring.join(' ');
    expect(pendenze).toMatch(/Obiettivi/);
    expect(pendenze).toMatch(/Prerequisiti/);
    expect(pendenze).toMatch(/Laboratorio/);
    expect(pendenze).toMatch(/Riepilogo/);
  });
});

describe('derivazione dell’articolo', () => {
  const articolo = deriveArticle(CAPITOLO_COMPLETO, {
    title: 'Incremental Tables',
    author: 'Daniel Meloni',
    projectTitle: 'Dataform in Pratica',
  });

  it('genera uno slug valido', () => {
    expect(articolo.slug).toBe('incremental-tables');
    expect(articolo.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('ricava la meta description dal testo reale, senza inventare', () => {
    expect(articolo.metaDescription.length).toBeLessThanOrEqual(160);
    expect(CAPITOLO_COMPLETO).toContain(articolo.metaDescription.slice(0, 30));
  });

  it('tronca la meta description sul confine di parola', () => {
    const lungo = deriveArticle(
      `# T\n\n${'parola '.repeat(80)}\n\n## Sezione\n\nCorpo.`,
      { title: 'T', author: 'A', projectTitle: 'P' },
    );
    expect(lungo.metaDescription.length).toBeLessThanOrEqual(160);
    expect(lungo.metaDescription.endsWith('…')).toBe(true);
    expect(lungo.metaDescription).not.toMatch(/paro…$/);
  });

  it('separa introduzione, corpo e conclusione', () => {
    expect(articolo.introduction).toContain('elaborano solo le righe nuove');
    expect(articolo.body).toContain('## Spiegazione');
    expect(articolo.body).not.toContain('## Riepilogo');
    expect(articolo.conclusion).toContain('riducono il costo');
  });

  it('riporta codice e immagini invariati', () => {
    expect(articolo.codeBlocks).toHaveLength(1);
    expect(articolo.codeBlocks[0]!.content).toContain('config');
  });

  it('calcola dati SEO verificabili', () => {
    expect(articolo.seo.wordCount).toBeGreaterThan(50);
    expect(articolo.seo.readingTimeMinutes).toBeGreaterThanOrEqual(1);
    expect(articolo.seo.keywords).toContain('incrementale');
    expect(articolo.seo.keywords).not.toContain('della');
  });

  it('lascia vuota la call to action e la dichiara', () => {
    expect(articolo.callToAction).toBe('');
    expect(articolo.pendingAuthoring.join(' ')).toMatch(/Call to action/);
  });
});

describe('parole chiave e tempo di lettura', () => {
  it('scarta le parole vuote di significato', () => {
    const parole = extractKeywords('della delle nella tabella tabella incrementale');
    expect(parole).toContain('tabella');
    expect(parole).not.toContain('della');
  });

  it('ordina per frequenza', () => {
    expect(extractKeywords('alfa alfa alfa beta beta gamma')[0]).toBe('alfa');
  });

  it('stima il tempo di lettura, mai sotto il minuto', () => {
    expect(readingTime(2000)).toBe(10);
    expect(readingTime(10)).toBe(1);
  });
});
