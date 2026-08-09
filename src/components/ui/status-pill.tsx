import { Badge } from './badge';
import {
  RUN_STATUS_LABELS,
  RUN_STATUS_TONES,
  type RunStatus,
} from '@/lib/workflow/status';
import { cn } from '@/lib/utils/cn';

/** Indicatore visivo dello stato di un workflow o di un agente. */
export function StatusPill({ status, className }: { status: RunStatus; className?: string }) {
  const isActive = status === 'running';
  return (
    <Badge tone={RUN_STATUS_TONES[status]} className={className}>
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full bg-current', isActive && 'animate-pulse')}
      />
      {RUN_STATUS_LABELS[status]}
    </Badge>
  );
}
