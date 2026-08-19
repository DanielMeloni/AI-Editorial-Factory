import { notFound } from 'next/navigation';
import { FileArchive } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SourceUploader } from '@/components/projects/source-uploader';
import { ReferenceLibrary } from '@/components/sources/reference-library';
import { FoundSources } from '@/components/sources/found-sources';
import { WebDiscovery } from '@/components/sources/web-discovery';
import { ToolLogo } from '@/components/visual/tool-logo';
import { CreateStructureButton, NextStepButton, SearchSourcesButton } from '@/components/sources/source-actions';
import { getProject, listSources } from '@/lib/projects/queries';
import {
  getNextStep,
  listProposedReferences,
  listReferences,
  listSuggestions,
} from '@/lib/sources/queries';
import { getToolLogo } from '@/lib/visual/queries';
import { isWebSearchEnabled } from '@/lib/ai/registry';
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

  const [sources, references, proposals, suggestions, nextStep, logo] = await Promise.all([
    listSources(projectId),
    listReferences(projectId),
    listProposedReferences(projectId),
    listSuggestions(projectId),
    getNextStep(projectId),
    getToolLogo(projectId),
  ]);

  const searchEnabled = isWebSearchEnabled();

  const daDecidere = suggestions.filter((s) => s.status === 'proposed').length;
  const indicizzate = references.filter((r) => r.status === 'indexed').length;

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Fonti"
        description="Biblioteca del progetto, fonti trovate automaticamente e archivi del manoscritto."
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchSourcesButton projectId={projectId} />
        <CreateStructureButton
          projectId={projectId}
          enabled={references.length > 0 || sources.length > 0}
        />
        <NextStepButton step={nextStep} />
        <p className="text-xs text-muted-foreground">{nextStep.detail}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Logo dello strumento</CardTitle>
          <CardDescription>
            Il marchio dello strumento di cui parla il volume — BigQuery, Dataform, quello che
            sia. Serve due volte: indica al modello colori e geometria da cui partire, e viene
            composto tale e quale sulla copertina e sulle anteprime dei corsi. Composto, non
            generato: un marchio ridisegnato da un modello somiglia al marchio, e somigliare non
            basta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ToolLogo projectId={projectId} logo={logo} />
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Ricerca sul web                                                    */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>
            Cerca fonti sul web
            {proposals.length > 0 ? (
              <Badge tone="info" className="ml-2 align-middle">
                {proposals.length} da decidere
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            L’AI cerca materiale di riferimento per il manuale — documentazione ufficiale,
            specifiche, guide — e ti mostra quello che ritiene utile, con il motivo di ogni
            scelta. <strong>Ogni indirizzo viene aperto prima di comparire qui</strong>: chi non
            risponde non entra nell’elenco, e il titolo che leggi è quello letto dalla pagina, non
            quello dichiarato. Accettando una fonte, questa entra in biblioteca e viene
            indicizzata.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WebDiscovery
            projectId={projectId}
            proposals={proposals}
            searchEnabled={searchEnabled}
          />
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Fonti trovate per le singole affermazioni                          */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>
            Fonti per le affermazioni
            {daDecidere > 0 ? (
              <Badge tone="info" className="ml-2 align-middle">
                {daDecidere} da decidere
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            Per ogni affermazione priva di rimando, la ricerca confronta il testo con la
            documentazione ufficiale e con la biblioteca del progetto. Accanto a ogni proposta
            trovi i termini che l’hanno prodotta: sono il motivo, e servono a decidere in un
            istante. Accettare una fonte la aggiunge alle citazioni del capitolo; il testo non
            viene toccato — dove collocare il rimando è una scelta editoriale.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FoundSources suggestions={suggestions} />
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Biblioteca                                                         */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>
            Biblioteca del progetto
            {indicizzate > 0 ? (
              <Badge tone="success" className="ml-2 align-middle">
                {indicizzate} indicizzate
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            Link e PDF che vuoi affiancare alla documentazione ufficiale. Vengono indicizzati —
            un PDF pagina per pagina — e da quel momento la ricerca automatica può proporli, con
            l’indicazione della pagina. L’origine resta sempre scritta su ogni proposta: una
            fonte della biblioteca non viene mai spacciata per documentazione del produttore.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReferenceLibrary projectId={projectId} references={references} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Archivio del manoscritto</CardTitle>
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
