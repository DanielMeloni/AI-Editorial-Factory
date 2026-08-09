import type { Metadata } from 'next';
import Link from 'next/link';
import { FolderKanban, Plus } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { requireUser } from '@/lib/auth/guards';
import { listProjects } from '@/lib/projects/queries';

export const metadata: Metadata = { title: 'Progetti' };

const STATUS_LABELS: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' }> = {
  draft: { label: 'Bozza', tone: 'neutral' },
  importing: { label: 'Importazione in corso', tone: 'info' },
  ready: { label: 'Pronto', tone: 'success' },
  archived: { label: 'Archiviato', tone: 'neutral' },
};

export default async function ProjectsPage() {
  const user = await requireUser();
  const projects = await listProjects();

  return (
    <>
      <Topbar email={user.email} crumbs={[{ label: 'Progetti' }]} />

      <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
        <PageHeader
          title="Progetti editoriali"
          description="Ogni progetto raccoglie un'opera: sorgenti, struttura, revisioni e pubblicazioni."
          actions={
            <Link href="/projects/new" className={buttonVariants({ variant: 'primary' })}>
              <Plus aria-hidden="true" />
              Nuovo progetto
            </Link>
          }
        />

        {projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="Nessun progetto"
            description="Crea il primo progetto, poi carica l'archivio ZIP del manuale per ricostruirne la struttura."
            action={
              <Link href="/projects/new" className={buttonVariants({ variant: 'primary' })}>
                Crea il primo progetto
              </Link>
            }
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => {
              const status = STATUS_LABELS[project.status] ?? STATUS_LABELS.draft!;
              return (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="block rounded-card transition-shadow hover:shadow-md focus-visible:shadow-md"
                  >
                    <Card className="h-full">
                      <CardContent className="space-y-3 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <h2 className="text-base font-semibold text-foreground">{project.title}</h2>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </div>
                        {project.subtitle ? (
                          <p className="text-sm text-muted-foreground">{project.subtitle}</p>
                        ) : null}
                        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {project.author ? (
                            <div className="flex gap-1">
                              <dt>Autore:</dt>
                              <dd className="font-medium text-foreground">{project.author}</dd>
                            </div>
                          ) : null}
                          {project.volume ? (
                            <div className="flex gap-1">
                              <dt>Volume:</dt>
                              <dd className="font-medium text-foreground">{project.volume}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
