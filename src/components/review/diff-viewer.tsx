'use client';

import { cn } from '@/lib/utils/cn';
import type { DiffHunk, DiffLine, WordSegment } from '@/lib/review/diff';

/**
 * Visualizzatore del confronto.
 *
 * Le righe di contesto sono neutre; le rimozioni e le aggiunte sono distinte da
 * colore **e** da simbolo (− / +), perché il colore da solo non è accessibile a
 * chi non lo distingue.
 *
 * Ogni blocco di modifica ha una casella di selezione: è ciò che rende possibile
 * accettarne alcune e non altre.
 */

function Words({ segments }: { segments: WordSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
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

function Line({ line, words }: { line: DiffLine; words?: WordSegment[] | null }) {
  const simbolo = line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ';

  return (
    <div
      className={cn(
        'grid grid-cols-[3.5rem_1.25rem_1fr] items-start gap-2 px-3 font-mono text-xs leading-relaxed',
        line.kind === 'added' && 'bg-success-surface/60',
        line.kind === 'removed' && 'bg-danger-surface/60',
      )}
    >
      <span className="select-none text-right text-muted-foreground/70">
        {line.baseLine ?? ''}
        {line.baseLine && line.proposedLine ? ' ' : ''}
        {line.kind === 'added' ? line.proposedLine : ''}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'select-none text-center font-semibold',
          line.kind === 'added' && 'text-success',
          line.kind === 'removed' && 'text-danger',
        )}
      >
        {simbolo}
      </span>
      <code className="whitespace-pre-wrap break-words">
        {words ? <Words segments={words} /> : line.text || ' '}
        <span className="sr-only">
          {line.kind === 'added' ? ' (riga aggiunta)' : line.kind === 'removed' ? ' (riga rimossa)' : ''}
        </span>
      </code>
    </div>
  );
}

export function DiffViewer({
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
  // Ogni riga appartenente a un blocco viene mostrata dentro il blocco stesso.
  const hunkByLine = new Map<DiffLine, DiffHunk>();
  for (const hunk of hunks) {
    for (const line of [...hunk.removed, ...hunk.added]) hunkByLine.set(line, hunk);
  }

  const elementi: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const hunk = hunkByLine.get(line);

    if (!hunk) {
      elementi.push(<Line key={`c-${index}`} line={line} />);
      index += 1;
      continue;
    }

    const totale = hunk.removed.length + hunk.added.length;
    const isSelected = selected.has(hunk.id);

    elementi.push(
      <div
        key={`h-${hunk.id}`}
        className={cn(
          'my-1 overflow-hidden rounded-lg border',
          isSelected ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border-subtle',
        )}
      >
        <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-muted px-3 py-1.5">
          {!readOnly ? (
            <input
              type="checkbox"
              id={`hunk-${hunk.id}`}
              checked={isSelected}
              onChange={() => onToggle(hunk.id)}
              className="size-4 rounded border-border-strong accent-[var(--primary)]"
            />
          ) : null}
          <label
            htmlFor={readOnly ? undefined : `hunk-${hunk.id}`}
            className="cursor-pointer text-xs font-medium text-foreground"
          >
            Modifica {hunk.id + 1} · riga {hunk.startBaseLine}
            <span className="ml-2 font-normal text-muted-foreground">
              {hunk.removed.length > 0 ? `−${hunk.removed.length} ` : ''}
              {hunk.added.length > 0 ? `+${hunk.added.length}` : ''}
            </span>
          </label>
        </div>

        <div className="py-1">
          {hunk.words && hunk.removed.length === 1 && hunk.added.length === 1 ? (
            <Line line={hunk.added[0]!} words={hunk.words} />
          ) : (
            <>
              {hunk.removed.map((l, i) => (
                <Line key={`r-${i}`} line={l} />
              ))}
              {hunk.added.map((l, i) => (
                <Line key={`a-${i}`} line={l} />
              ))}
            </>
          )}
        </div>
      </div>,
    );

    index += totale;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle bg-surface py-2">
      {elementi}
    </div>
  );
}
