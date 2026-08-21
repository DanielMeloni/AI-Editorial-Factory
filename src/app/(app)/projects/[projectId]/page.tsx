import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, BookOpen, FileStack, Layers, ListTree, Upload } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { getCurrentManifest, getProject, getProjectStructure, listProjectVolumes, listSources } from '@/lib/projects/queries';
import { etichettaDirezione } from '@/lib/editorial/direzione';
import { etichettaBrief } from '@/lib/editorial/brief';
import { DeleteProjectCard } from '@/components/projects/delete-project-card';
import { getProjectProgress } from '@/lib/projects/progress';
import { NextStepCard } from '@/components/projects/next-step-card';
import { addProjectVolume } from '@/lib/projects/actions';
import { ProjectVolumesAccordion } from '@/components/projects/project-volumes-accordion';

export default async function ProjectOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ volume?: string }>;
}) {
  const { projectId } = await params;
  const { volume: requestedVolume } = await searchParams;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [sources, structure, manifest, progresso, volumes] = await Promise.all([
    listSources(projectId),
    getProjectStructure(projectId),
    getCurrentManifest(projectId),
    getProjectProgress(projectId),
    listProjectVolumes(projectId),
  ]);

  const erroriGravi = (manifest?.discrepancies ?? []).filter((d) => d.severity === 'error');
  const avvisi = (manifest?.discrepancies ?? []).filter((d) => d.severity === 'warning');

  const metriche = [
    { label: 'Capitoli', value: structure.totals.chapters, icon: ListTree },
    { label: 'Appendici', value: structure.totals.appendices, icon: Layers },
    { label: 'Parole', value: structure.totals.words.toLocaleString('it-IT'), icon: FileStack },
    { label: 'Archivi caricati', value: sources.length, icon: Upload },
  ];

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title={project.title}
        description={
          // La direzione editoriale sta accanto al titolo perché è ciò che
          // distingue questo volume dagli altri sullo stesso argomento.
          `${project.subtitle ?? 'Panoramica del progetto editoriale.'} · ${etichettaDirezione({
            level: project.level,
            tone: project.tone,
            register: project.register,
            styleNotes: project.style_notes,
          })} · ${etichettaBrief({
            workShape: project.work_shape,
            targetPages: project.target_pages,
            scope: project.scope,
            outOfScope: project.out_of_scope,
            audience: project.audience,
          })}`
        }
        actions={
          <Link
            href={`/projects/${projectId}/sources`}
            className={buttonVariants({ variant: 'secondary' })}
          >
            <Upload aria-hidden="true" />
            Gestisci fonti
          </Link>
        }
      />

      <NextStepCard progresso={progresso} volumeId={volumes.some((v) => v.id === requestedVolume) ? requestedVolume : volumes[0]?.id} />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3"><CardTitle className="flex items-center gap-2"><BookOpen className="size-5" aria-hidden="true" />Manuali della collana</CardTitle><form action={addProjectVolume}><input type="hidden" name="projectId" value={projectId} /><button className={buttonVariants({ variant: 'secondary' })}>Aggiungi volume</button></form></div>
          <CardDescription>Un solo progetto, con una configurazione editoriale distinta per ciascun volume.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectVolumesAccordion projectId={projectId} volumes={volumes} />
        </CardContent>
      </Card>

      {sources.length === 0 ? (
        <EmptyState
          icon={Upload}
          title="Nessun archivio caricato"
          description="Carica l'archivio ZIP del manuale: verrà analizzato in sicurezza per ricostruire parti, capitoli, appendici e asset."
          action={
            <Link
              href={`/projects/${projectId}/sources`}
              className={buttonVariants({ variant: 'primary' })}
            >
              Carica l’archivio
            </Link>
          }
        />
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metriche.map((metrica) => (
              <Card key={metrica.label}>
                <CardContent className="flex items-center gap-3 p-5">
                  <metrica.icon className="size-5 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <dt className="text-xs text-muted-foreground">{metrica.label}</dt>
                    <dd className="text-xl font-semibold text-foreground">{metrica.value}</dd>
                  </div>
                </CardContent>
              </Card>
            ))}
          </dl>

          {erroriGravi.length > 0 ? (
            <Alert tone="danger" title={`${erroriGravi.length} differenze da risolvere`}>
              <ul className="list-inside list-disc space-y-1">
                {erroriGravi.slice(0, 5).map((d, index) => (
                  <li key={index}>{d.message}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          {avvisi.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
                  Segnalazioni dal confronto fra indice e cartelle
                  <Badge tone="warning">{avvisi.length}</Badge>
                </CardTitle>
                <CardDescription>
                  Differenze non bloccanti: l’indice dichiarato e la struttura reale non coincidono
                  del tutto.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {avvisi.slice(0, 8).map((d, index) => (
                    <li key={index}>{d.message}</li>
                  ))}
                  {avvisi.length > 8 ? <li>…e altre {avvisi.length - 8}.</li> : null}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
      <DeleteProjectCard projectId={projectId} title={project.title} />

    </main>
  );
}
