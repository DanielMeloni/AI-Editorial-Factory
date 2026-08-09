import type { z } from 'zod';
import type { verifiableClaimSchema } from '../schemas';

type Claim = z.infer<typeof verifiableClaimSchema>;

/**
 * Individuazione delle affermazioni verificabili.
 *
 * Un'affermazione verificabile è una frase che asserisce un fatto controllabile
 * sulla documentazione o su una misura: «riduce i costi del 90%», «Dataform non
 * supporta X», «è sempre più veloce». Sono le frasi che un manuale tecnico deve
 * poter sostenere con una fonte.
 *
 * Il riconoscimento è lessicale e volutamente prudente: meglio segnalare una
 * frase in più che lasciarne passare una infondata.
 */

interface Pattern {
  regex: RegExp;
  category: Claim['category'];
}

const PATTERNS: Pattern[] = [
  // Quantificazioni e misure.
  // Il confine di parola finale vale solo per le unità alfabetiche: dopo «%»
  // c'è quasi sempre uno spazio, e fra due caratteri non-parola \b non trova
  // corrispondenza — «riduce del 90% i costi» sfuggirebbe al riconoscimento.
  {
    regex: /\b\d+([.,]\d+)?\s*(?:%|\b(?:per\s?cento|volte|ms|secondi|minuti|ore|GB|TB|MB)\b)/i,
    category: 'prestazioni',
  },
  { regex: /\b(cost[oi]|prezzo|tariffa|fatturazione|addebit\w+)\b/i, category: 'costo' },

  // Assoluti
  { regex: /\b(sempre|mai|qualsiasi|ogni caso|in nessun caso|garantisce|garantito)\b/i, category: 'comportamento' },

  // Supporto e limiti
  { regex: /\b(non\s+(supporta|permette|consente|funziona)|impossibile|non\s+è\s+possibile)\b/i, category: 'limite' },
  { regex: /\b(limite|massimo di|quota|soglia)\b/i, category: 'limite' },

  // Comportamento del prodotto
  { regex: /\b(Dataform|BigQuery)\s+\w*\s*(esegue|crea|aggiorna|elimina|richiede|applica|gestisce)\b/i, category: 'comportamento' },
  { regex: /\b(più\s+(veloce|lento|efficiente)|riduce|migliora|peggiora|ottimizza)\b/i, category: 'prestazioni' },

  // Sintassi
  { regex: /\b(la sintassi|va scritto|si dichiara|deve essere dichiarat\w+|va configurat\w+)\b/i, category: 'sintassi' },
];

/** Frasi che indicano una fonte a supporto nelle immediate vicinanze. */
const SOURCE_HINT = /\b(documentazione|docs?|riferimento|secondo|vedi|fonte|cfr\.?)\b/i;

/** Divide il testo in frasi, ignorando le abbreviazioni più comuni. */
function splitSentences(text: string): string[] {
  return text
    .replace(/\b(es|cfr|ecc|art|fig|cap|pag|vol|sig|dott)\.\s/gi, '$1_ ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/_\s/g, '. ').trim())
    .filter((s) => s.length > 0);
}

/**
 * Estrae le affermazioni verificabili dal testo, ignorando i blocchi di codice
 * (che vengono analizzati altrove) e i titoli.
 */
export function extractClaims(contentMd: string, linkLines: Set<number>): Claim[] {
  const lines = contentMd.split(/\r?\n/);
  const claims: Claim[] = [];

  let inFence = false;
  let fenceMarker = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNumber = index + 1;

    const fence = /^(\s{0,3})(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[2]!;
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker.startsWith(fenceMarker[0]!) && marker.length >= fenceMarker.length) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('|')) continue;

    for (const sentence of splitSentences(trimmed)) {
      if (sentence.length < 25) continue;

      const matched = PATTERNS.find((pattern) => pattern.regex.test(sentence));
      if (!matched) continue;

      claims.push({
        statement: sentence.slice(0, 600),
        line: lineNumber,
        // Una fonte è considerata presente se la riga contiene un collegamento
        // oppure un rimando esplicito alla documentazione.
        hasSupportingSource: linkLines.has(lineNumber) || SOURCE_HINT.test(sentence),
        category: matched.category,
      });
    }
  }

  return claims.slice(0, 200);
}
