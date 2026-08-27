/**
 * Vocabolario unico degli stati di esecuzione, condiviso da workflow e agenti.
 * Questi valori corrispondono agli enum PostgreSQL creati nella Fase 2.
 */
export const RUN_STATUSES = [
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'completed_with_warnings',
  'failed',
  'cancelled',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** Esiti bloccanti del preflight editoriale 1.1. Non sono terminali: indicano
 * quale correzione deve rientrare nel workflow prima di un nuovo tentativo. */
export const EDITORIAL_BLOCKING_STATUSES = [
  'needs_content_fix',
  'needs_source_fix',
  'needs_visual_fix',
  'needs_layout_fix',
] as const;

export type EditorialBlockingStatus = (typeof EDITORIAL_BLOCKING_STATUSES)[number];

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'In coda',
  running: 'In esecuzione',
  awaiting_approval: 'In attesa di approvazione',
  completed: 'Completato',
  completed_with_warnings: 'Completato con avvisi',
  failed: 'Fallito',
  cancelled: 'Annullato',
};

export const RUN_STATUS_TONES = {
  queued: 'neutral',
  running: 'info',
  awaiting_approval: 'warning',
  completed: 'success',
  completed_with_warnings: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
} as const satisfies Record<RunStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'>;

/** Uno stato terminale non puo' piu' evolvere senza un nuovo tentativo. */
export function isTerminalStatus(status: RunStatus): boolean {
  return (
    status === 'completed' ||
    status === 'completed_with_warnings' ||
    status === 'failed' ||
    status === 'cancelled'
  );
}
