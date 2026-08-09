import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, FileText, GitBranch } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { WorkflowControls } from '@/components/workflows/workflow-controls';
import { getProject } from '@/lib/projects/queries';
import {
  getActiveRunForChapter,
  getChapter,
  listChapterAssets,
  listChapterIssues,
} from '@/lib/workflows/queries';
import { isTerminalStatus } from '@/lib/workflow/status';

const SEVERITY_TONE = {
  critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral', info: 'info',
} as const;

const SEVERITY_LABEL = {
  critical: 'critico', high: 'alto', medium: 'medio', low: 'basso', info: 'informativo',
} as const;

export default async function ChapterPage({
  params,
}: {
  params: Promise<{ projectId: string; chapterId: string }>;
}) {
  const { projectId, chapterId } = await params;
  const [project, chapter] = await Promise.all([getProject(projectId), getChapter(chapterId)]);

  if (!project || !chapter || chapter.project_id !== projectId) notFound();

  const [issues, assets, run] = await Promise.all([
    listChapterIssues(chapterId),
    listChapterAssets(chapterId),
    getActiveRunForChapter(chapterId),
  ]);

  const inCorso = run !== null && !isTerminalStatus(run.status);
  const etichetta =
    chapter.kind === 'appendix'
      ? `Appendice ${chapter.label ?? ''}`.trim()
      : chapter.number !== null
        ? `Capitolo ${chapter.number}`
        : 'Elemento';

  const perGravita = (['critical', 'high', 'medium', 'low', 'info'] as const).map((severity) => ({
    severity,
    count: issues.filter((issue) => issue.severity === severity).length,
  }));

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title={`${etichetta} — ${chapter.title}`}
        description={
          `${chapter.word_count.toLocaleString('it-IT')} parole · ${chapter.code_block_count} blocchi di codice · ` +
          `${chapter.figure_count} figure · ${chapter.placeholder_count} segnaposto`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {inCorso ? (
              <WorkflowControls comando="cancel" targetId={run.id} variant="secondary" />
            ) : (
              <WorkflowControls comando="start" targetId={chapterId} />
            )}
          </div>
        }
      />

      {run ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              Ultima esecuzione
              <StatusPill status={run.status} />
            </CardTitle>
            <CardDescription>
              {run.current_step ? `Passaggio: ${run.current_step}. ` : ''}
              {run.completed_steps}/{run.total_steps} completati ·{' '}
              <Link href={`/projects/${projectId}/workflows`} className="text-primary hover:underline">
                vedi la cronologia
              </Link>
            </CardDescription>
          </CardHeader>
          {run.status === 'awaiting_approval' ? (
            <CardContent>
              <Alert tone="warning" title="In attesa della tua decisione">
                Il workflow è sospeso e non consuma risorse finché non decidi.{' '}
                <Link
                  href={`/projects/${projectId}/reviews`}
                  className="font-medium text-primary hover:underline"
                >
                  Apri la revisione
                </Link>{' '}
                per confrontare originale e proposta.
              </Alert>
            </CardContent>
          ) : null}
          {run.error?.message ? (
            <CardContent>
              <Alert tone="danger" title="Esecuzione fallita">
                {run.error.message}
              </Alert>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="size-4 text-muted-foreground" aria-hidden="true" />
              Rilievi
              {issues.length > 0 ? <Badge tone="neutral">{issues.length}</Badge> : null}
            </CardTitle>
            {issues.length > 0 ? (
              <CardDescription className="flex flex-wrap gap-1.5">
                {perGravita
                  .filter((g) => g.count > 0)
                  .map((g) => (
                    <Badge key={g.severity} tone={SEVERITY_TONE[g.severity]}>
                      {g.count} {SEVERITY_LABEL[g.severity]}
                    </Badge>
                  ))}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            {issues.length === 0 ? (
              <EmptyState
                title="Nessun rilievo"
                description="Avvia l'audit tecnico per analizzare codice, affermazioni e riferimenti."
                className="m-5 py-8"
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {issues.slice(0, 30).map((issue) => (
                  <li key={issue.id} className="space-y-1 px-5 py-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Badge tone={SEVERITY_TONE[issue.severity]}>
                        {SEVERITY_LABEL[issue.severity]}
                      </Badge>
                      <span className="font-medium text-foreground">{issue.title}</span>
                      {issue.location?.line !== null && issue.location?.line !== undefined ? (
                        <span className="text-xs text-muted-foreground">riga {issue.location.line}</span>
                      ) : null}
                    </div>
                    {issue.detail ? (
                      <p className="text-sm text-muted-foreground">{issue.detail}</p>
                    ) : null}
                    {issue.suggestion ? (
                      <p className="text-sm text-foreground/80">→ {issue.suggestion}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
              Diagrammi generati
              {assets.length > 0 ? <Badge tone="neutral">{assets.length}</Badge> : null}
            </CardTitle>
            <CardDescription>
              Prodotti da codice, non da un modello visuale: sono esatti per costruzione.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {assets.length === 0 ? (
              <EmptyState
                title="Nessun diagramma"
                description="I diagrammi vengono generati dall'audit a partire dalle dipendenze dichiarate nel codice."
                className="py-8"
              />
            ) : (
              assets.map((asset) => (
                <figure key={asset.id} className="space-y-2">
                  <figcaption className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-foreground">{asset.title}</span>
                    <Badge tone={asset.status === 'approved' ? 'success' : 'warning'}>
                      {asset.status === 'approved' ? 'approvato' : 'da approvare'}
                    </Badge>
                    <Badge tone="neutral">v{asset.version}</Badge>
                  </figcaption>
                  {asset.mermaid_source ? (
                    <pre className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-muted p-3 text-xs">
                      <code>{asset.mermaid_source}</code>
                    </pre>
                  ) : null}
                  {asset.caption ? (
                    <p className="text-xs text-muted-foreground">{asset.caption}</p>
                  ) : null}
                </figure>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {chapter.source_path ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="size-3.5" aria-hidden="true" />
          Origine: <code className="font-mono">{chapter.source_path}</code>
        </p>
      ) : null}
    </main>
  );
}
