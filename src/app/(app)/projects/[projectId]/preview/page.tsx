import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, Download } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { RebuildPreviewButton } from '@/components/publish/rebuild-preview-button';
import { getProject } from '@/lib/projects/queries';
import { getVolumePreviewInfo } from '@/lib/publish/queries';
import { composeVolume, etichettaCapitolo } from '@/lib/publish/volume';
import { createClient } from '@/lib/supabase/server';

/**
 * Anteprima del volume.
 *
 * Mostra il PDT composto finora, non un rendering diverso di quello che poi si
 * stamperà: è lo stesso file che il workflow aggiorna a ogni capitolo
 * convalidato. Accanto, l'elenco di ciò che è dentro e di ciò che manca —
 * perché la domanda vera davanti a un'anteprima è sempre «cosa non c'è ancora».
 */
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const supabase = await createClient();
  const [volume, anteprima] = await Promise.all([
    composeVolume(supabase, projectId),
    getVolumePreviewInfo(projectId),
  ]);

  // Il PDF arriva da una rotta della stessa origine: la Content Security Policy
  // chiude i frame a «self», e servirlo da qui è preferibile ad allargarla.
  const percorso = `/api/projects/${projectId}/preview`;

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Anteprima del volume"
        description={
          volume.totals.chapters === 0
            ? 'Raccoglie i capitoli convalidati. Approva una revisione e il capitolo comparirà qui.'
            : `${volume.totals.chapters} capitoli convalidati · ${volume.totals.words.toLocaleString('it-IT')} parole` +
              `${volume.pending.length > 0 ? ` · ${volume.pending.length} ancora da convalidare` : ''}`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <RebuildPreviewButton projectId={projectId} />
            {anteprima ? (
              <a
                href={`${percorso}?download=1`}
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                <Download aria-hidden="true" />
                Scarica il PDF
              </a>
            ) : null}
          </div>
        }
      />

      {volume.pending.length > 0 ? (
        <Alert tone="info" title={`${volume.pending.length} capitoli non sono nell’anteprima`}>
          L’anteprima contiene soltanto ciò che è stato approvato. Mancano:{' '}
          {volume.pending
            .slice(0, 6)
            .map((capitolo) => capitolo.title)
            .join(', ')}
          {volume.pending.length > 6 ? ` e altri ${volume.pending.length - 6}` : ''}.
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {anteprima ? (
          <Card className="overflow-hidden">
            <iframe
              src={percorso}
              title="Anteprima del volume in PDF"
              className="h-[80vh] w-full border-0 bg-surface-muted"
            />
          </Card>
        ) : (
          <EmptyState
            icon={BookOpen}
            title="Anteprima non ancora composta"
            description="Premi «Ricomponi l’anteprima» oppure approva una revisione: il workflow la aggiorna da solo al passaggio finale."
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cosa contiene</CardTitle>
            <CardDescription>Nell’ordine in cui si legge.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {volume.chapters.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">
                Nessun capitolo convalidato, per ora.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {volume.chapters.map((capitolo) => (
                  <li key={capitolo.id} className="flex flex-wrap items-baseline gap-2 px-5 py-2.5">
                    <span className="w-28 shrink-0 text-xs font-medium text-muted-foreground">
                      {etichettaCapitolo(capitolo)}
                    </span>
                    <Link
                      href={`/projects/${projectId}/chapters/${capitolo.id}`}
                      className="min-w-0 flex-1 text-sm font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {capitolo.title}
                    </Link>
                    <Badge tone="neutral">v{capitolo.versionNo}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
