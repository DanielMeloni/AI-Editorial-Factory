import { diffLines, diffWordsWithSpace } from 'diff';

/**
 * Motore di confronto fra due versioni di un capitolo.
 *
 * Due esigenze guidano la forma di questo modulo:
 *
 *  1. Il diff deve essere leggibile: differenze riga per riga, con evidenza
 *     delle parole cambiate all'interno delle righe modificate.
 *  2. Il diff deve essere **selezionabile**: il revisore può accettare alcune
 *     modifiche e non altre. Per questo le differenze sono raggruppate in
 *     blocchi indipendenti, e da una selezione di blocchi si sa ricostruire il
 *     testo risultante — esattamente, carattere per carattere.
 */

export type LineKind = 'context' | 'added' | 'removed';

export interface DiffLine {
  kind: LineKind;
  text: string;
  /** Numero di riga nella versione di partenza. */
  baseLine: number | null;
  /** Numero di riga nella versione proposta. */
  proposedLine: number | null;
}

export interface WordSegment {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

export interface DiffHunk {
  id: number;
  /** Righe rimosse dalla versione di partenza. */
  removed: DiffLine[];
  /** Righe aggiunte dalla versione proposta. */
  added: DiffLine[];
  /** Confronto per parole, disponibile quando il blocco sostituisce una riga sola. */
  words: WordSegment[] | null;
  startBaseLine: number;
  startProposedLine: number;
}

export interface DiffResult {
  lines: DiffLine[];
  hunks: DiffHunk[];
  stats: { added: number; removed: number; unchanged: number };
  identical: boolean;
}

/** Divide in righe conservando l'informazione sull'ultima riga vuota. */
function toLines(text: string): string[] {
  return text.split('\n');
}

export function computeDiff(base: string, proposed: string): DiffResult {
  if (base === proposed) {
    const lines = toLines(base).map((text, index) => ({
      kind: 'context' as const,
      text,
      baseLine: index + 1,
      proposedLine: index + 1,
    }));
    return {
      lines,
      hunks: [],
      stats: { added: 0, removed: 0, unchanged: lines.length },
      identical: true,
    };
  }

  const parts = diffLines(base, proposed);

  const lines: DiffLine[] = [];
  const hunks: DiffHunk[] = [];

  let baseLine = 1;
  let proposedLine = 1;
  let pendingRemoved: DiffLine[] = [];
  let pendingAdded: DiffLine[] = [];

  const flush = () => {
    if (pendingRemoved.length === 0 && pendingAdded.length === 0) return;

    const words =
      pendingRemoved.length === 1 && pendingAdded.length === 1
        ? diffWordsWithSpace(pendingRemoved[0]!.text, pendingAdded[0]!.text).map((part) => ({
            kind: part.added ? ('added' as const) : part.removed ? ('removed' as const) : ('same' as const),
            text: part.value,
          }))
        : null;

    hunks.push({
      id: hunks.length,
      removed: pendingRemoved,
      added: pendingAdded,
      words,
      startBaseLine: pendingRemoved[0]?.baseLine ?? baseLine,
      startProposedLine: pendingAdded[0]?.proposedLine ?? proposedLine,
    });

    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const part of parts) {
    // `diffLines` restituisce blocchi che terminano con \n: l'ultimo elemento
    // dello split è una stringa vuota da scartare, tranne quando il blocco non
    // termina con newline.
    const chunk = part.value.split('\n');
    if (chunk[chunk.length - 1] === '') chunk.pop();

    if (part.removed) {
      for (const text of chunk) {
        pendingRemoved.push({ kind: 'removed', text, baseLine, proposedLine: null });
        baseLine += 1;
      }
      continue;
    }

    if (part.added) {
      for (const text of chunk) {
        pendingAdded.push({ kind: 'added', text, baseLine: null, proposedLine });
        proposedLine += 1;
      }
      continue;
    }

    flush();
    for (const text of chunk) {
      lines.push({ kind: 'context', text, baseLine, proposedLine });
      baseLine += 1;
      proposedLine += 1;
    }
  }

  flush();

  // Le righe dei blocchi vengono inserite nella sequenza complessiva, in ordine.
  const complete: DiffLine[] = [];
  let contextIndex = 0;
  let hunkIndex = 0;

  while (contextIndex < lines.length || hunkIndex < hunks.length) {
    const nextContext = lines[contextIndex];
    const nextHunk = hunks[hunkIndex];

    const contextPos = nextContext?.baseLine ?? Number.POSITIVE_INFINITY;
    const hunkPos = nextHunk?.startBaseLine ?? Number.POSITIVE_INFINITY;

    if (hunkPos <= contextPos && nextHunk) {
      complete.push(...nextHunk.removed, ...nextHunk.added);
      hunkIndex += 1;
    } else if (nextContext) {
      complete.push(nextContext);
      contextIndex += 1;
    } else {
      break;
    }
  }

  const added = hunks.reduce((sum, hunk) => sum + hunk.added.length, 0);
  const removed = hunks.reduce((sum, hunk) => sum + hunk.removed.length, 0);

  return {
    lines: complete,
    hunks,
    stats: { added, removed, unchanged: lines.length },
    identical: false,
  };
}

/**
 * Ricostruisce il testo applicando alla versione di partenza soltanto i blocchi
 * selezionati.
 *
 * È l'operazione che rende possibile «approva questa modifica ma non quella».
 * Deve essere esatta: con tutti i blocchi selezionati deve restituire la
 * proposta identica, con nessuno l'originale identico. Entrambe le proprietà
 * sono verificate dai test.
 */
export function applySelectedHunks(
  base: string,
  proposed: string,
  selectedHunkIds: number[],
): string {
  const selected = new Set(selectedHunkIds);
  const diff = computeDiff(base, proposed);

  if (diff.identical) return base;

  // Una stringa vuota è un documento senza righe, non un documento con una
  // riga vuota: `''.split('\n')` restituisce [''] e produrrebbe una riga
  // fantasma in coda al risultato.
  const baseLines = base === '' ? [] : toLines(base);
  const output: string[] = [];

  // Mappa: riga della base → blocco che la sostituisce.
  const hunkByBaseLine = new Map<number, DiffHunk>();
  const consumedBaseLines = new Set<number>();
  const pureInsertions: DiffHunk[] = [];

  for (const hunk of diff.hunks) {
    if (hunk.removed.length === 0) {
      pureInsertions.push(hunk);
      continue;
    }
    hunkByBaseLine.set(hunk.removed[0]!.baseLine!, hunk);
    for (const line of hunk.removed) consumedBaseLines.add(line.baseLine!);
  }

  /** Inserimenti puri da collocare prima di una data riga della base. */
  const insertionsBefore = (line: number) =>
    pureInsertions.filter((hunk) => hunk.startBaseLine === line);

  for (let index = 0; index < baseLines.length; index += 1) {
    const lineNumber = index + 1;

    for (const hunk of insertionsBefore(lineNumber)) {
      if (selected.has(hunk.id)) output.push(...hunk.added.map((l) => l.text));
    }

    const hunk = hunkByBaseLine.get(lineNumber);
    if (hunk) {
      if (selected.has(hunk.id)) output.push(...hunk.added.map((l) => l.text));
      else output.push(...hunk.removed.map((l) => l.text));
      continue;
    }

    if (consumedBaseLines.has(lineNumber)) continue;
    output.push(baseLines[index]!);
  }

  // Inserimenti in coda, oltre l'ultima riga della base.
  for (const hunk of pureInsertions) {
    if (hunk.startBaseLine > baseLines.length && selected.has(hunk.id)) {
      output.push(...hunk.added.map((l) => l.text));
    }
  }

  return output.join('\n');
}

/** Riepilogo testuale del confronto, per etichette e riepiloghi. */
export function summarizeDiff(diff: DiffResult): string {
  if (diff.identical) return 'Nessuna differenza.';
  const blocchi = diff.hunks.length;
  return (
    `${blocchi} ${blocchi === 1 ? 'modifica' : 'modifiche'}: ` +
    `${diff.stats.added} righe aggiunte, ${diff.stats.removed} rimosse.`
  );
}
