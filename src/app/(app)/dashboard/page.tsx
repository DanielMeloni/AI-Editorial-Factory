import type { Metadata } from 'next';
import Link from 'next/link';
import {
  FileDown,
  FolderKanban,
  ImageIcon,
  ListChecks,
  ShieldAlert,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/guards';
import { listProjects } from '@/lib/projects/queries';
import { countPendingReviews } from '@/lib/review/queries';

export const metadata: Metadata = { title: 'Dashboard' };

/** Pannelli non ancora alimentati: mostrano un empty state, mai dati finti. */
const PANELS_IN_ATTESA = [
  { title: 'Workflow attivi', icon: Workflow, empty: 'Nessun workflow in esecuzione. Arrivano con la Fase 3.' },
  { title: 'Problemi tecnici aperti', icon: ShieldAlert, empty: 'Nessun problema tecnico rilevato.' },
  { title: 'Immagini da approvare', icon: ImageIcon, empty: 'Nessun asset visuale in attesa.' },
  { title: 'Esportazioni recenti', icon: FileDown, empty: 'Nessuna esportazione prodotta.' },
] as const;

export default async function DashboardPage() {
  const user = await requireUser();
  const projects = await listProjects();
  const revisioniInAttesa = await countPendingReviews();

  return (
    <>
      <Topbar email={user.email} crumbs={[{ label: 'Dashboard' }]} />

      <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
        <PageHeader
          title="Dashboard"
          description="Stato della redazione: progetti, workflow, revisioni e pubblicazioni."
          actions={
            <Link href="/projects/new" className={buttonVariants({ variant: 'primary' })}>
              <Sparkles aria-hidden="true" />
              Nuovo progetto
            </Link>
          }
        />

        <Alert tone="info" title="Fase 2 completata: database, sicurezza e importazione">
          Progetti, caricamento archivi, riconoscimento della struttura e manifesto editoriale sono
          operativi. Workflow, agenti e revisione arrivano nella Fase 3.
        </Alert>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FolderKanban className="size-4 text-muted-foreground" aria-hidden="true" />
                Progetti recenti
              </CardTitle>
            </CardHeader>
            <CardContent>
              {projects.length === 0 ? (
                <EmptyState
                  title="Nessun progetto"
                  description="Crea un progetto e carica l'archivio del manuale per iniziare."
                  className="py-8"
                  action={
                    <Link href="/projects/new" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                      Crea progetto
                    </Link>
                  }
                />
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {projects.slice(0, 5).map((project) => (
                    <li key={project.id}>
                      <Link
                        href={`/projects/${project.id}`}
                        className="flex items-baseline justify-between gap-3 py-2.5 hover:underline"
                      >
                        <span className="font-medium text-foreground">{project.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {new Date(project.updated_at).toLocaleDateString('it-IT')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ListChecks className="size-4 text-muted-foreground" aria-hidden="true" />
                Revisioni in attesa
              </CardTitle>
            </CardHeader>
            <CardContent>
              {revisioniInAttesa.length === 0 ? (
                <EmptyState
                  title="Nessuna revisione"
                  description="Nessun contenuto è in attesa della tua approvazione."
                  className="py-8"
                />
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {revisioniInAttesa.slice(0, 5).map((review) => (
                    <li key={review.id}>
                      <Link
                        href={`/projects/${review.project_id}/reviews/${review.id}`}
                        className="flex items-baseline justify-between gap-3 py-2.5 hover:underline"
                      >
                        <span className="min-w-0 truncate font-medium text-foreground">
                          {review.chapter_title}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {new Date(review.requested_at).toLocaleDateString('it-IT')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {PANELS_IN_ATTESA.map((panel) => (
            <Card key={panel.title}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <panel.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  {panel.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState title="Nessun elemento" description={panel.empty} className="py-8" />
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </>
  );
}
