import { notFound } from 'next/navigation';
import { BookOpen, FileDown, GraduationCap, Newspaper } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PublishPanel } from '@/components/publish/publish-panel';
import { DownloadButton } from '@/components/publish/download-button';
import { DeleteExportButton } from '@/components/publish/delete-export-button';
import { getProject } from '@/lib/projects/queries';
import { listExportableChapters, listExports, listOutputs } from '@/lib/publish/queries';

const STATO = {
  queued: { label: 'in coda', tone: 'neutral' },
  running: { label: 'in corso', tone: 'info' },
  ready: { label: 'pronto', tone: 'success' },
  failed: { label: 'fallito', tone: 'danger' },
} as const;

const FORMATO_LABEL = {
  markdown: 'Markdown',
  html: 'HTML',
  pdf: 'PDF',
  json: 'JSON',
  epub: 'EPUB',
} as const;

const TIPO_OUTPUT = {
  manual: { label: 'Manuale', icon: BookOpen },
  lesson: { label: 'Lezione', icon: GraduationCap },
  article: { label: 'Articolo', icon: Newspaper },
} as const;

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export default async function ExportsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [chapters, exports, outputs] = await Promise.all([
    listExportableChapters(projectId),
    listExports(projectId),
    listOutputs(projectId),
  ]);

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Pubblicazioni"
        description="PDF, EPUB e HTML derivati dalla versione approvata. I file restano in archivio privato."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <PublishPanel chapters={chapters} />

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Esportazioni</CardTitle>
              <CardDescription>
                Il download passa da un collegamento firmato che scade in due minuti.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {exports.length === 0 ? (
                <EmptyState
                  icon={FileDown}
                  title="Nessuna esportazione"
                  description="Scegli un capitolo e i formati da produrre."
                  className="m-5 py-8"
                />
              ) : (
                <ul className="divide-border-subtle divide-y">
                  {exports.map((esportazione) => {
                    const stato = STATO[esportazione.status];
                    const capitolo = esportazione.chapters;
                    const etichetta = `${FORMATO_LABEL[esportazione.format]} — ${capitolo?.title ?? 'capitolo rimosso'}`;
                    return (
                      <li
                        key={esportazione.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3"
                      >
                        <Badge tone="neutral">{FORMATO_LABEL[esportazione.format]}</Badge>
                        <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                          {capitolo
                            ? `${capitolo.label ? `${capitolo.label} — ` : ''}${capitolo.title}`
                            : 'Capitolo rimosso'}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {formatBytes(esportazione.byte_size)}
                        </span>
                        <Badge tone={stato.tone}>{stato.label}</Badge>
                        {esportazione.format === 'pdf' ? (
                          <Badge tone={esportazione.preflight_status === 'passed' ? 'success' : esportazione.preflight_status === 'failed' ? 'danger' : 'neutral'}>
                            preflight {esportazione.preflight_status === 'passed' ? 'superato' : esportazione.preflight_status === 'failed' ? 'fallito' : 'in attesa'}
                          </Badge>
                        ) : null}
                        {esportazione.status === 'ready' ? (
                          <DownloadButton exportId={esportazione.id} label="Scarica" />
                        ) : null}
                        {esportazione.status !== 'running' ? (
                          <DeleteExportButton exportId={esportazione.id} label={etichetta} />
                        ) : null}
                        {esportazione.error ? (
                          <p className="text-danger w-full text-xs">{esportazione.error}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Lezioni e articoli derivati</CardTitle>
              <CardDescription>
                Ciò che il capitolo contiene viene estratto alla lettera; ciò che manca resta
                dichiarato, non inventato.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {outputs.length === 0 ? (
                <EmptyState
                  title="Nessuna derivazione"
                  description="Attiva «Deriva lezione e articolo» durante l'esportazione."
                  className="m-5 py-8"
                />
              ) : (
                <ul className="divide-border-subtle divide-y">
                  {outputs.map((output) => {
                    const tipo = TIPO_OUTPUT[output.kind];
                    const pendenze = Array.isArray(
                      (output.content as { pendingAuthoring?: unknown }).pendingAuthoring,
                    )
                      ? (output.content as { pendingAuthoring: string[] }).pendingAuthoring
                      : [];

                    return (
                      <li key={output.id} className="space-y-1.5 px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <tipo.icon className="text-muted-foreground size-4" aria-hidden="true" />
                          <span className="text-foreground text-sm font-medium">
                            {output.title}
                          </span>
                          <Badge tone="neutral">{tipo.label}</Badge>
                          {output.slug ? (
                            <code className="text-muted-foreground text-xs">/{output.slug}</code>
                          ) : null}
                        </div>

                        {pendenze.length > 0 ? (
                          <details className="text-xs">
                            <summary className="text-warning cursor-pointer">
                              {pendenze.length} punt{pendenze.length === 1 ? 'o' : 'i'} da scrivere
                            </summary>
                            <ul className="text-muted-foreground mt-1 list-inside list-disc space-y-0.5">
                              {pendenze.map((voce, index) => (
                                <li key={index}>{voce}</li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
