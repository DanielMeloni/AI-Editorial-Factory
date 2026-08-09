import { StatusPill } from '@/components/ui/status-pill';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import type { AgentRunRow, WorkflowRunRow } from '@/lib/workflows/queries';
import type { RunStatus } from '@/lib/workflow/status';

/** I passaggi previsti dal workflow, nell'ordine in cui vengono eseguiti. */
const STEPS: { key: string; label: string }[] = [
  { key: 'caricamento-capitolo', label: 'Caricamento del capitolo' },
  { key: 'verifica-tecnica', label: 'Analisi tecnica del codice' },
  { key: 'verifica-fonti', label: 'Verifica dei riferimenti' },
  { key: 'salvataggio-audit', label: 'Salvataggio dell’audit' },
  { key: 'proposta-revisione', label: 'Proposta di revisione' },
  { key: 'piano-visuale', label: 'Piano visuale' },
  { key: 'generazione-diagrammi', label: 'Generazione dei diagrammi' },
  { key: 'richiesta-approvazione', label: 'Richiesta di approvazione' },
  { key: 'attesa-approvazione', label: 'Attesa della decisione umana' },
  { key: 'salvataggio-versione', label: 'Salvataggio della versione approvata' },
];

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function WorkflowTimeline({
  run,
  agentRuns,
}: {
  run: WorkflowRunRow;
  agentRuns: AgentRunRow[];
}) {
  const currentIndex = STEPS.findIndex((step) => step.key === run.current_step);
  const terminato = ['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(
    run.status,
  );

  const perStep = new Map(agentRuns.map((agentRun) => [agentRun.step_name ?? '', agentRun]));

  return (
    <ol className="space-y-0">
      {STEPS.map((step, index) => {
        const agentRun = perStep.get(step.key);
        const passato = currentIndex > index || (terminato && run.status !== 'failed');
        const attuale = currentIndex === index && !terminato;
        const fallito = run.status === 'failed' && currentIndex === index;

        return (
          <li key={step.key} className="flex gap-3">
            {/* Colonna del filo conduttore */}
            <div className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={cn(
                  'mt-1.5 size-2.5 shrink-0 rounded-full ring-4',
                  fallito
                    ? 'bg-danger ring-danger/15'
                    : attuale
                      ? 'animate-pulse bg-info ring-info/15'
                      : passato
                        ? 'bg-success ring-success/15'
                        : 'bg-border-strong ring-transparent',
                )}
              />
              {index < STEPS.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn('w-px flex-1', passato ? 'bg-success/40' : 'bg-border-subtle')}
                />
              ) : null}
            </div>

            <div className="min-w-0 flex-1 pb-5">
              <p
                className={cn(
                  'text-sm',
                  attuale || passato || fallito ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </p>

              {agentRun ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <StatusPill status={agentRun.status as RunStatus} />
                  <span>
                    {agentRun.provider === 'deterministic'
                      ? 'analisi deterministica'
                      : `${agentRun.provider} · ${agentRun.model}`}
                  </span>
                  <span>{formatDuration(agentRun.duration_ms)}</span>
                  {agentRun.input_tokens + agentRun.output_tokens > 0 ? (
                    <span>
                      {agentRun.input_tokens + agentRun.output_tokens} token · $
                      {agentRun.estimated_cost_usd.toFixed(4)}
                    </span>
                  ) : (
                    <Badge tone="neutral">nessun costo</Badge>
                  )}
                  {agentRun.confidence !== null ? (
                    <span>confidenza {(agentRun.confidence * 100).toFixed(0)}%</span>
                  ) : null}
                  {agentRun.warnings.length > 0 ? (
                    <Badge tone="warning">{agentRun.warnings.length} avvisi</Badge>
                  ) : null}
                </div>
              ) : null}

              {agentRun?.error?.message ? (
                <p className="mt-1 text-xs text-danger">{agentRun.error.message}</p>
              ) : null}

              {fallito && run.error?.message ? (
                <p className="mt-1 text-xs text-danger">{run.error.message}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
