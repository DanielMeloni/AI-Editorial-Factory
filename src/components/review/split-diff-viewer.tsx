'use client';

import { cn } from '@/lib/utils/cn';
import type { DiffHunk, DiffLine, WordSegment } from '@/lib/review/diff';

/**
 * Confronto affiancato: a sinistra la versione precedente, a destra la
 * proposta, per l'intero capitolo e non per i soli punti cambiati.
 *
 * La vista in linea resta la più precisa per leggere una modifica; questa è la
 * più adatta a giudicare il capitolo nel suo insieme, che è la domanda a cui
 * risponde chi approva. Le due colonne restano allineate riga per riga: dove
 * una versione non ha nulla da mostrare, la cella resta vuota invece di far
 * scorrere il testo e disallineare tutto il resto.
 *
 * Colore e simbolo insieme, come nella vista in linea: il colore da solo non è
 * accessibile a chi non lo distingue.
 */

interface Riga {
  hunkId: number | null;
  sinistra: DiffLine | null;
  destra: DiffLine | null;
  /** Confronto per parole, quando il blocco sostituisce una riga sola. */
  words: WordSegment[] | null;
}

/** Accoppia le righe delle due versioni conservando l'ordine del documento. */
function appaia(lines: DiffLine[], hunks: DiffHunk[]): Riga[] {
  const hunkByLine = new Map<DiffLine, DiffHunk>();
  for (const hunk of hunks) {
    for (const line of [...hunk.removed, ...hunk.added]) hunkByLine.set(line, hunk);
  }

  const righe: Riga[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const hunk = hunkByLine.get(line);

    if (!hunk) {
      righe.push({ hunkId: null, sinistra: line, destra: line, words: null });
      index += 1;
      continue;
    }

    const coppie = Math.max(hunk.removed.length, hunk.added.length);
    for (let i = 0; i < coppie; i += 1) {
      righe.push({
        hunkId: hunk.id,
        sinistra: hunk.removed[i] ?? null,
        destra: hunk.added[i] ?? null,
        words: coppie === 1 ? hunk.words : null,
      });
    }

    index += hunk.removed.length + hunk.added.length;
  }

  return righe;
}

function Parole({ segments, lato }: { segments: WordSegment[]; lato: 'sinistra' | 'destra' }) {
  return (
    <>
      {segments
        .filter((segment) =>
          lato === 'sinistra' ? segment.kind !== 'added' : segment.kind !== 'removed',
        )
        .map((segment, index) => (
          <span
            key={index}
            className={cn(
              segment.kind === 'added' && 'rounded bg-success/25 px-0.5',
              segment.kind === 'removed' && 'rounded bg-danger/25 px-0.5 line-through',
            )}
          >
            {segment.text}
          </span>
        ))}
    </>
  );
}

function Cella({
  line,
  lato,
  words,
}: {
  line: DiffLine | null;
  lato: 'sinistra' | 'destra';
  words: WordSegment[] | null;
}) {
  if (!line) {
    return <div aria-hidden="true" className="bg-surface-muted/40" />;
  }

  const numero = lato === 'sinistra' ? line.baseLine : line.proposedLine;
  const simbolo = line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : '';

  return (
    <div
      className={cn(
        'grid grid-cols-[3rem_1fr] items-start gap-2 bg-surface px-2 font-mono text-xs leading-relaxed',
        line.kind === 'added' && 'bg-success-surface/60',
        line.kind === 'removed' && 'bg-danger-surface/60',
      )}
    >
      <span className="select-none text-right text-muted-foreground/70">
        <span aria-hidden="true" className={cn(
          'mr-1 font-semibold',
          line.kind === 'added' && 'text-success',
          line.kind === 'removed' && 'text-danger',
        )}>
          {simbolo}
        </span>
        {numero ?? ''}
      </span>
      <code className="whitespace-pre-wrap break-words">
        {words ? <Parole segments={words} lato={lato} /> : line.text || ' '}
        <span className="sr-only">
          {line.kind === 'added'
            ? ' (riga aggiunta)'
            : line.kind === 'removed'
              ? ' (riga rimossa)'
              : ''}
        </span>
      </code>
    </div>
  );
}

export function SplitDiffViewer({
  lines,
  hunks,
  selected,
  onToggle,
  readOnly = false,
}: {
  lines: DiffLine[];
  hunks: DiffHunk[];
  selected: Set<number>;
  onToggle: (hunkId: number) => void;
  readOnly?: boolean;
}) {
  const righe = appaia(lines, hunks);
  const perId = new Map(hunks.map((hunk) => [hunk.id, hunk]));

  const elementi: React.ReactNode[] = [];

  for (let i = 0; i < righe.length; i += 1) {
    const riga = righe[i]!;
    const apreBlocco = riga.hunkId !== null && righe[i - 1]?.hunkId !== riga.hunkId;

    if (apreBlocco) {
      const hunk = perId.get(riga.hunkId!)!;
      const isSelected = selected.has(hunk.id);
      elementi.push(
        <div
          key={`t-${hunk.id}`}
          className={cn(
            'col-span-2 flex items-center gap-2 border-y px-3 py-1.5',
            isSelected
              ? 'border-primary/40 bg-primary/10'
              : 'border-border-subtle bg-surface-muted',
          )}
        >
          {!readOnly ? (
            <input
              type="checkbox"
              id={`split-hunk-${hunk.id}`}
              checked={isSelected}
              onChange={() => onToggle(hunk.id)}
              className="size-4 rounded border-border-strong accent-[var(--primary)]"
            />
          ) : null}
          <label
            htmlFor={readOnly ? undefined : `split-hunk-${hunk.id}`}
            className="cursor-pointer text-xs font-medium text-foreground"
          >
            Modifica {hunk.id + 1} · riga {hunk.startBaseLine}
            <span className="ml-2 font-normal text-muted-foreground">
              {hunk.removed.length > 0 ? `−${hunk.removed.length} ` : ''}
              {hunk.added.length > 0 ? `+${hunk.added.length}` : ''}
            </span>
          </label>
        </div>,
      );
    }

    elementi.push(
      <Cella key={`s-${i}`} line={riga.sinistra} lato="sinistra" words={riga.words} />,
      <Cella key={`d-${i}`} line={riga.destra} lato="destra" words={riga.words} />,
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
      <div className="grid grid-cols-2 border-b border-border-subtle bg-surface-muted text-xs font-medium">
        <div className="border-r border-border-subtle px-3 py-1.5 text-muted-foreground">
          Prima delle modifiche
        </div>
        <div className="px-3 py-1.5 text-muted-foreground">Dopo le modifiche</div>
      </div>

      <div className="grid max-h-[70vh] grid-cols-2 gap-x-px overflow-auto bg-border-subtle py-1">
        {elementi}
      </div>
    </div>
  );
}
