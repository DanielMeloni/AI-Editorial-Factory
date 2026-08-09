import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ListChecks } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { getProject } from '@/lib/projects/queries';
import { listReviewRequests } from '@/lib/review/queries';

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

  const reviews = await listReviewRequests(projectId);
  const inAttesa = reviews.filter((r) => r.status === 'pending');

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

      {reviews.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nessuna revisione"
          description="Le revisioni nascono dall'audit tecnico di un capitolo: avvialo dalla scheda Struttura."
        />
      ) : (
        <ul className="space-y-3">
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
              <li key={review.id}>
                <Link href={`/projects/${projectId}/reviews/${review.id}`} className="block">
                  <Card className="transition-shadow hover:shadow-md">
                    <CardContent className="flex flex-wrap items-start justify-between gap-3 p-5">
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
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
