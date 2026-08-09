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
