/**
 * Ricerca delle fonti mancanti.
 *
 * Sta qui, e non dentro l'agente, perché serve in tre momenti diversi: durante
 * l'audit del capitolo, quando l'autore preme «Cerca fonti», e quando aggiunge
 * un PDF alla biblioteca e vuole sapere che cosa quel PDF sostiene. Un'unica
 * implementazione per tutti e tre: le proposte non possono dipendere da quale
 * pulsante è stato premuto.
 */

import type { SourceCandidate, SourceIndex } from './match';
import { DEFAULT_LIMIT, searchIndex } from './match';

/** Categoria di un'affermazione, ripetuta qui per non legare il modulo agli agenti. */
export type ResearchCategory =
  | 'comportamento' | 'sintassi' | 'prestazioni' | 'costo' | 'limite' | 'altro';

export interface ResearchClaim {
  statement: string;
  line: number;
  hasSupportingSource: boolean;
  category: ResearchCategory;
}

export interface ResearchSuggestion {
  line: number;
  statement: string;
  category: ResearchCategory;
  candidates: SourceCandidate[];
}

export interface ResearchResult {
  suggestions: ResearchSuggestion[];
  /** Affermazioni senza fonte per cui non è stato trovato nulla di pertinente. */
  unmatched: number;
  /** Affermazioni prive di rimando esaminate: il denominatore del risultato. */
  examined: number;
}

export interface ResearchOptions {
  /** Candidati per affermazione. */
  limit?: number;
  minScore?: number;
}

/**
 * Cerca una fonte per ogni affermazione priva di rimando.
 *
 * Le affermazioni di categoria «altro» vengono ignorate: sono quelle che il
 * riconoscimento non ha saputo classificare, e cercare una fonte per una frase
 * di cui non si sa neppure di che parla produce solo rumore.
 */
export function researchClaims(
  claims: readonly ResearchClaim[],
  index: SourceIndex,
  options: ResearchOptions = {},
): ResearchResult {
  const senzaFonte = claims.filter(
    (claim) => !claim.hasSupportingSource && claim.category !== 'altro',
  );

  const suggestions: ResearchSuggestion[] = [];
  let unmatched = 0;

  for (const claim of senzaFonte) {
    const candidates = searchIndex(index, claim.statement, {
      category: claim.category,
      limit: options.limit ?? DEFAULT_LIMIT,
      minScore: options.minScore,
    });

    if (candidates.length === 0) {
      unmatched += 1;
      continue;
    }

    suggestions.push({
      line: claim.line,
      statement: claim.statement,
      category: claim.category,
      candidates,
    });
  }

  return { suggestions, unmatched, examined: senzaFonte.length };
}

/**
 * Unisce due insiemi di proposte sulla stessa affermazione.
 *
 * Serve quando la documentazione ufficiale e la biblioteca del progetto vengono
 * interrogate in due momenti: i candidati confluiscono sulla stessa riga,
 * ordinati per punteggio, senza doppioni.
 *
 * L'ordinamento **non** privilegia l'origine: se una specifica caricata
 * dall'autore spiega l'affermazione meglio della documentazione, viene prima.
 * A dire da dove viene ciascuna proposta pensa il campo `origin`.
 */
export function mergeSuggestions(
  base: readonly ResearchSuggestion[],
  extra: readonly ResearchSuggestion[],
  limitPerClaim = DEFAULT_LIMIT,
): ResearchSuggestion[] {
  const byLine = new Map<number, ResearchSuggestion>();

  for (const suggestion of [...base, ...extra]) {
    const existing = byLine.get(suggestion.line);

    if (!existing) {
      byLine.set(suggestion.line, { ...suggestion, candidates: [...suggestion.candidates] });
      continue;
    }

    const visti = new Set(
      existing.candidates.map((candidate) => identity(candidate)),
    );
    for (const candidate of suggestion.candidates) {
      if (visti.has(identity(candidate))) continue;
      visti.add(identity(candidate));
      existing.candidates.push(candidate);
    }
  }

  return [...byLine.values()]
    .map((suggestion) => ({
      ...suggestion,
      candidates: suggestion.candidates
        .sort((a, b) => b.score - a.score || identity(a).localeCompare(identity(b)))
        .slice(0, limitPerClaim),
    }))
    .sort((a, b) => a.line - b.line);
}

/** Identità di un candidato: la fonte, e la pagina quando c'è. */
function identity(candidate: SourceCandidate): string {
  const base = candidate.referenceId ?? candidate.url ?? candidate.title;
  return candidate.page === null ? base : `${base}#${candidate.page}`;
}
