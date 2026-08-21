'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Clock3, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import type { WorkflowRunRow } from '@/lib/workflows/queries';

const STEP_LABELS: Record<string, string> = {
  'caricamento-capitolo': 'Caricamento', 'stesura-capitolo': 'Stesura completa',
  'verifica-tecnica': 'Verifica tecnica', 'verifica-fonti': 'Verifica fonti',
  'ricerca-biblioteca': 'Ricerca in biblioteca', 'verifica-collegamenti': 'Verifica collegamenti',
  'salvataggio-audit': 'Salvataggio audit', 'proposta-revisione': 'Revisione editoriale',
  'piano-visuale': 'Piano delle grafiche', 'generazione-diagrammi': 'Generazione grafiche',
  'richiesta-approvazione': 'Preparazione revisione', 'attesa-approvazione': 'Attende la tua revisione',
  'salvataggio-versione': 'Convalida capitolo', 'anteprima-volume': 'Aggiornamento anteprima',
};

export function ChapterAuditStatus({ chapterId, initialRun, initialWords }: { chapterId: string; initialRun: WorkflowRunRow | null; initialWords: number }) {
  const [run, setRun] = useState(initialRun);
  const [words, setWords] = useState(initialWords);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [runResult, chapterResult] = await Promise.all([
      supabase.from('workflow_runs').select('*').eq('chapter_id', chapterId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle<WorkflowRunRow>(),
      supabase.from('chapters').select('word_count').eq('id', chapterId)
        .maybeSingle<{ word_count: number }>(),
    ]);
    if (runResult.data) setRun(runResult.data);
    if (chapterResult.data) setWords(chapterResult.data.word_count);
  }, [chapterId]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`audit-capitolo-${chapterId}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'workflow_runs', filter: `chapter_id=eq.${chapterId}`,
    }, (event) => setRun(event.new as WorkflowRunRow)).on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'chapters', filter: `id=eq.${chapterId}`,
    }, (event) => {
      const updated = event.new as { word_count?: number };
      if (typeof updated.word_count === 'number') setWords(updated.word_count);
    });
    channel.subscribe();
    const poll = setInterval(() => void refresh(), 3_000);
    return () => { clearInterval(poll); void supabase.removeChannel(channel); };
  }, [chapterId, refresh]);

  if (!run) return <span className="text-xs text-muted-foreground">Audit non avviato</span>;
  const active = run.status === 'queued' || run.status === 'running';
  const waiting = run.status === 'awaiting_approval';
  const complete = run.status === 'completed' || run.status === 'completed_with_warnings';
  const failed = run.status === 'failed' || run.status === 'cancelled';
  const percent = Math.min(100, Math.round((run.completed_steps / Math.max(run.total_steps, 1)) * 100));
  const label = run.status === 'queued' ? 'In coda' : STEP_LABELS[run.current_step ?? ''] ?? (complete ? 'Completato' : failed ? 'Interrotto' : 'In elaborazione');

  return <div className="w-full min-w-48 max-w-64" role="status" aria-live="polite">
    <div className={cn('flex items-center gap-1.5 text-xs font-medium', active && 'text-info', waiting && 'text-warning', complete && 'text-success', failed && 'text-danger')}>
      {active ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : waiting ? <Clock3 className="size-3.5 animate-pulse" aria-hidden="true" /> : complete ? <Check className="size-3.5" aria-hidden="true" /> : <AlertCircle className="size-3.5" aria-hidden="true" />}
      <span className="truncate">{label}</span><span className="ml-auto whitespace-nowrap tabular-nums">{words.toLocaleString('it-IT')} parole · {percent}%</span>
    </div>
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
      <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out', active && 'animate-pulse bg-info', waiting && 'bg-warning', complete && 'bg-success', failed && 'bg-danger')} style={{ width: `${percent}%` }} />
    </div>
  </div>;
}
