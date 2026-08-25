import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Workflow } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { WorkflowTimeline } from '@/components/workflows/workflow-timeline';
import { WorkflowControls } from '@/components/workflows/workflow-controls';
import { LiveRefresh } from '@/components/workflows/live-refresh';
import { getProject } from '@/lib/projects/queries';
import { listAgentRuns, listWorkflowRuns } from '@/lib/workflows/queries';
import { isTerminalStatus } from '@/lib/workflow/status';

function chapterLabel(chapter: NonNullable<Awaited<ReturnType<typeof listWorkflowRuns>>[number]['chapter']>) {
  const prefix = chapter.label?.trim()
    ? chapter.label.trim()
    : chapter.kind === 'appendix'
      ? chapter.number !== null
        ? `Appendice ${chapter.number}`
        : 'Appendice'
      : chapter.number !== null
        ? `Capitolo ${chapter.number}`
        : 'Capitolo';

  return `${prefix} – ${chapter.title}`;
}

export default async function WorkflowsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const runs = await listWorkflowRuns(projectId);
  const inCorso = runs.some((run) => !isTerminalStatus(run.status));
  const agentRunsPerRun = await Promise.all(runs.slice(0, 10).map((run) => listAgentRuns(run.id)));

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Workflow"
        description="Esecuzioni durevoli: proseguono anche a browser chiuso e sopravvivono a un nuovo deploy."
      />

      <LiveRefresh projectId={projectId} attiva={inCorso} />

      {runs.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="Nessuna esecuzione"
          description="Apri un capitolo dalla scheda Struttura e avvia l'audit tecnico."
        />
      ) : (
        <div className="space-y-4">
          {runs.map((run, index) => {
            const agentRuns = agentRunsPerRun[index] ?? [];
            const costo = agentRuns.reduce((sum, a) => sum + Number(a.estimated_cost_usd), 0);

            return (
              <Card key={run.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        Audit tecnico
                        <StatusPill status={run.status} />
                      </CardTitle>
                      <CardDescription>
                        Avviato il {new Date(run.created_at).toLocaleString('it-IT')} · tentativo{' '}
                        {run.attempt} · {run.completed_steps}/{run.total_steps} passaggi
                        {costo > 0 ? ` · $${costo.toFixed(4)}` : ' · nessun costo'}
                      </CardDescription>
                      {run.chapter ? (
                        <p className="text-sm font-medium text-foreground">
                          Capitolo interessato:{' '}
                          {run.chapter_id ? (
                            <Link
                              href={`/projects/${projectId}/chapters/${run.chapter_id}`}
                              className="text-primary hover:underline"
                            >
                              {chapterLabel(run.chapter)}
                            </Link>
                          ) : (
                            chapterLabel(run.chapter)
                          )}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Capitolo interessato: non disponibile
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {run.chapter_id ? (
                        <Link
                          href={`/projects/${projectId}/chapters/${run.chapter_id}`}
                          className="text-sm text-primary hover:underline"
                        >
                          Apri capitolo
                        </Link>
                      ) : null}
                      {!isTerminalStatus(run.status) ? (
                        <WorkflowControls comando="cancel" targetId={run.id} variant="secondary" />
                      ) : null}
                      {run.status === 'failed' || run.status === 'cancelled' ? (
                        <WorkflowControls comando="retry" targetId={run.id} variant="secondary" />
                      ) : null}
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <WorkflowTimeline run={run} agentRuns={agentRuns} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
