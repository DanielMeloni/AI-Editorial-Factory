import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ListChecks } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { getProject } from '@/lib/projects/queries';
import { listReviewRequests } from '@/lib/review/queries';
import { listWorkflowRuns } from '@/lib/workflows/queries';
import { isTerminalStatus } from '@/lib/workflow/status';
import { LiveRefresh } from '@/components/workflows/live-refresh';

const STATO = {
  pending: { label: 'In attesa di decisione', tone: 'warning' },
  approved: { label: 'Approvata', tone: 'success' },
  rejected: { label: 'Rifiutata', tone: 'danger' },
  changes_requested: { label: 'Modifiche richieste', tone: 'info' },
} as const;

export default async function ReviewsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [reviews, runs] = await Promise.all([
    listReviewRequests(projectId),
    listWorkflowRuns(projectId),
  ]);
  const inAttesa = reviews.filter((r) => r.status === 'pending');

  // Qui l'ascolto serve soprattutto quando l'elenco è ancora vuoto: la
  // revisione deve comparire da sé nel momento in cui il workflow la chiede.
  const inCorso = runs.some((run) => !isTerminalStatus(run.status));

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Revisioni"
        description={
          inAttesa.length > 0
            ? `${inAttesa.length} in attesa della tua decisione. Nessun contenuto viene pubblicato senza approvazione.`
            : 'Nessun contenuto viene pubblicato senza approvazione umana.'
        }
      />

      <LiveRefresh projectId={projectId} attiva={inCorso} />

      {reviews.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nessuna revisione"
          description="Le revisioni nascono dall'audit tecnico di un capitolo: avvialo dalla scheda Struttura."
        />
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => {
            const stato = STATO[review.status];
            const capitolo = review.chapters;
            const etichetta = capitolo
              ? capitolo.label
                ? `Appendice ${capitolo.label}`
                : capitolo.number !== null
                  ? `Capitolo ${capitolo.number}`
                  : ''
              : '';

            return (
              <details key={review.id} className="group overflow-hidden rounded-lg border border-border-subtle bg-surface" open={review.status === 'pending'}>
                <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 p-5 hover:bg-surface-muted">
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-foreground">
                          {etichetta ? `${etichetta} — ` : ''}
                          {capitolo?.title ?? review.title}
                        </p>
                        {review.summary ? (
                          <p className="text-sm text-muted-foreground">{review.summary}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          Richiesta il {new Date(review.requested_at).toLocaleString('it-IT')}
                          {review.decided_at
                            ? ` · decisa il ${new Date(review.decided_at).toLocaleString('it-IT')}`
                            : ''}
                        </p>
                      </div>
                      <Badge tone={stato.tone}>{stato.label}</Badge>
                </summary>
                <div className="border-t border-border-subtle p-5">
                  <p className="mb-4 text-sm text-muted-foreground">Apri il banco di revisione per confrontare originale e proposta, modificare il testo, approvare tutto o solo singoli interventi. Dopo l’approvazione il capitolo viene inserito automaticamente nell’anteprima.</p>
                  <Link href={`/projects/${projectId}/reviews/${review.id}`} className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Revisiona questo capitolo</Link>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </main>
  );
}
