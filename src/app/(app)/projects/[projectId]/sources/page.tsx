import { notFound } from 'next/navigation';
import { FileArchive } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SourceUploader } from '@/components/projects/source-uploader';
import { getProject, listSources } from '@/lib/projects/queries';
import type { SourceStatus } from '@/lib/db/types';

const STATUS: Record<SourceStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  uploaded: { label: 'Caricato', tone: 'neutral' },
  extracting: { label: 'Estrazione in corso', tone: 'info' },
  extracted: { label: 'Estratto', tone: 'success' },
  partial: { label: 'Estratto con errori', tone: 'warning' },
  failed: { label: 'Fallito', tone: 'danger' },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export default async function SourcesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const sources = await listSources(projectId);

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Fonti"
        description="Archivi caricati e loro stato di elaborazione."
      />

      <Card>
        <CardHeader>
          <CardTitle>Carica un archivio</CardTitle>
          <CardDescription>
            Solo file .zip, fino a 1 GiB. L’archivio viene inviato direttamente allo storage privato
            e analizzato sul server: percorsi verificati contro path traversal, hash SHA-256 per ogni
            file, file di sistema ignorati.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SourceUploader projectId={projectId} />
        </CardContent>
      </Card>

      {sources.length === 0 ? (
        <EmptyState
          icon={FileArchive}
          title="Nessun archivio"
          description="Non è ancora stato caricato alcun archivio per questo progetto."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Archivi caricati</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Elenco degli archivi caricati</caption>
                <thead className="border-y border-border-subtle bg-surface-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">Nome</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Dimensione</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">File</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Ignorati</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Errori</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Stato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {sources.map((source) => {
                    const status = STATUS[source.status];
                    return (
                      <tr key={source.id}>
                        <td className="px-5 py-3 font-medium text-foreground">
                          {source.original_filename}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {formatBytes(source.byte_size)}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{source.file_count}</td>
                        <td className="px-5 py-3 text-muted-foreground">{source.ignored_count}</td>
                        <td className="px-5 py-3 text-muted-foreground">{source.error_count}</td>
                        <td className="px-5 py-3">
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {sources.some((s) => s.error_count > 0 || s.error_message) ? (
        <Card>
          <CardHeader>
            <CardTitle>Errori parziali</CardTitle>
            <CardDescription>
              Voci scartate durante l’estrazione. Il resto dell’archivio è stato importato.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {sources.flatMap((source) =>
                (source.errors ?? []).slice(0, 15).map((issue, index) => (
                  <li key={`${source.id}-${index}`}>
                    <code className="font-mono text-xs">{issue.path || '—'}</code> — {issue.reason}
                  </li>
                )),
              )}
              {sources
                .filter((s) => s.error_message)
                .map((s) => (
                  <li key={`${s.id}-msg`} className="text-danger">
                    {s.error_message}
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
