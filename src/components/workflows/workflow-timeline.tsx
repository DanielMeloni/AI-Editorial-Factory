import { StatusPill } from '@/components/ui/status-pill';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import type { AgentRunRow, WorkflowRunRow } from '@/lib/workflows/queries';
import type { RunStatus } from '@/lib/workflow/status';

/**
 * I passaggi del workflow, nell'ordine in cui vengono eseguiti.
 *
 * Ogni voce porta con sé una riga che dice cosa succede lì. I nomi tecnici da
 * soli — «verifica-fonti», «piano-visuale» — sono chiari a chi ha scritto il
 * codice e opachi a chi guarda un'esecuzione andare avanti; e chi guarda vuole
 * sapere due cose: a che punto siamo e se deve fare qualcosa.
 */
const STEPS: { key: string; label: string; nota: string }[] = [
  {
    key: 'caricamento-capitolo',
    label: '1 · Caricamento del capitolo',
    nota: 'Legge il testo corrente ed estrae titoli, codice, collegamenti e figure.',
  },
  {
    key: 'stesura-capitolo',
    label: '2 · Stesura del capitolo',
    nota: 'Scrive il capitolo dalle fonti: prima la scaletta, poi una sezione per volta, infine riassunto, quiz e laboratorio.',
  },
  {
    key: 'verifica-tecnica',
    label: '3 · Analisi tecnica',
    nota: 'Controlla i blocchi SQLX e JavaScript e individua le affermazioni da verificare.',
  },
  {
    key: 'verifica-fonti',
    label: '4 · Verifica dei riferimenti',
    nota: 'Giudica le fonti citate e cerca la documentazione ufficiale per le affermazioni che ne sono prive.',
  },
  {
    key: 'ricerca-biblioteca',
    label: '5 · Ricerca nella biblioteca',
    nota: 'Aggiunge alle proposte i documenti e i collegamenti che hai caricato tu.',
  },
  {
    key: 'verifica-collegamenti',
    label: '6 · Verifica dei collegamenti',
    nota: 'Apre gli indirizzi proposti per accertare che rispondano davvero.',
  },
  {
    key: 'salvataggio-audit',
    label: '7 · Salvataggio dell’audit',
    nota: 'Registra rilievi, citazioni e fonti proposte.',
  },
  {
    key: 'proposta-revisione',
    label: '8 · Proposta di revisione',
    nota: 'Propone le correzioni come nuova versione: l’originale resta intatto.',
  },
  {
    key: 'piano-visuale',
    label: '9 · Piano visuale',
    nota: 'Decide quali figure servono e dove.',
  },
  {
    key: 'generazione-diagrammi',
    label: '10 · Generazione dei diagrammi',
    nota: 'Disegna i grafi delle dipendenze dal codice: esatti per costruzione, senza modello.',
  },
  {
    key: 'richiesta-approvazione',
    label: '11 · Richiesta di approvazione',
    nota: 'Prepara il confronto fra la versione di partenza e quella proposta.',
  },
  {
    key: 'attesa-approvazione',
    label: '12 · Attesa della tua decisione',
    nota: 'Il workflow è sospeso e non consuma risorse: riparte quando approvi o rifiuti dalla scheda Revisioni.',
  },
  {
    key: 'salvataggio-versione',
    label: '13 · Salvataggio della versione',
    nota: 'Rende corrente la versione approvata.',
  },
  {
    key: 'anteprima-volume',
    label: '14 · Anteprima del volume',
    nota: 'Ricompone il PDF del libro includendo il capitolo appena convalidato.',
  },
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
              <p className="mt-0.5 text-xs text-muted-foreground">{step.nota}</p>

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
