import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, History, ImageIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { ReviewWorkbench } from '@/components/review/review-workbench';
import { getProject } from '@/lib/projects/queries';
import { getChapter, listChapterAssets, listChapterIssues } from '@/lib/workflows/queries';
import { getReviewRequest, getVersion, listComments, listVersions } from '@/lib/review/queries';
import { AssetApproval } from '@/components/review/asset-approval';

const ORIGINE = {
  original: { label: 'Originale', tone: 'neutral' },
  ai_proposal: { label: 'Proposta AI', tone: 'info' },
  human_edit: { label: 'Modifica umana', tone: 'accent' },
  approved: { label: 'Approvata', tone: 'success' },
} as const;

const SEVERITY_TONE = {
  critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral', info: 'info',
} as const;

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; reviewId: string }>;
}) {
  const { projectId, reviewId } = await params;

  const [project, review] = await Promise.all([getProject(projectId), getReviewRequest(reviewId)]);
  if (!project || !review || review.project_id !== projectId) notFound();

  const [chapter, comments, versions] = await Promise.all([
    getChapter(review.chapter_id),
    listComments(reviewId),
    listVersions(review.chapter_id),
  ]);

  const [base, proposed, issues, assets] = await Promise.all([
    review.base_version_id ? getVersion(review.base_version_id) : Promise.resolve(null),
    review.proposed_version_id ? getVersion(review.proposed_version_id) : Promise.resolve(null),
    listChapterIssues(review.chapter_id),
    listChapterAssets(review.chapter_id),
  ]);

  const readOnly = review.status !== 'pending';
  const etichetta = chapter
    ? chapter.label
      ? `Appendice ${chapter.label}`
      : chapter.number !== null
        ? `Capitolo ${chapter.number}`
        : ''
    : '';

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title={`Revisione — ${etichetta ? `${etichetta} · ` : ''}${chapter?.title ?? review.title}`}
        description={review.summary ?? undefined}
        actions={
          <Link
            href={`/projects/${projectId}/chapters/${review.chapter_id}`}
            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Apri il capitolo
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        }
      />

      {review.decision_note ? (
        <Alert tone={review.status === 'approved' ? 'success' : 'info'} title="Nota della decisione">
          {review.decision_note}
        </Alert>
      ) : null}

      {!base || !proposed ? (
        <Alert tone="warning" title="Confronto non disponibile">
          Questa revisione non ha entrambe le versioni collegate: l’audit potrebbe non aver prodotto
          alcuna proposta perché il capitolo non presentava problemi correggibili.
        </Alert>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <ReviewWorkbench
              reviewId={reviewId}
              baseContent={base.content_md}
              proposedContent={proposed.content_md}
              comments={comments}
              readOnly={readOnly}
            />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  Figure proposte
                  {assets.length > 0 ? <Badge tone="neutral">{assets.length}</Badge> : null}
                </CardTitle>
                <CardDescription>
                  Si approvano una per una, e separatamente dal testo: sono due giudizi diversi
                  sulla stessa revisione.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AssetApproval assets={assets} readOnly={readOnly} />
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="size-4 text-muted-foreground" aria-hidden="true" />
                  Rilievi dell’audit
                  {issues.length > 0 ? <Badge tone="neutral">{issues.length}</Badge> : null}
                </CardTitle>
                <CardDescription>Le ragioni della proposta.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {issues.length === 0 ? (
                  <p className="px-5 pb-5 text-sm text-muted-foreground">Nessun rilievo.</p>
                ) : (
                  <ul className="max-h-96 divide-y divide-border-subtle overflow-y-auto">
                    {issues.slice(0, 20).map((issue) => (
                      <li key={issue.id} className="space-y-1 px-5 py-2.5">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
                          <span className="text-sm font-medium text-foreground">{issue.title}</span>
                          {issue.location?.line ? (
                            <span className="text-xs text-muted-foreground">
                              riga {issue.location.line}
                            </span>
                          ) : null}
                        </div>
                        {issue.detail ? (
                          <p className="text-xs text-muted-foreground">{issue.detail}</p>
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
                  <History className="size-4 text-muted-foreground" aria-hidden="true" />
                  Cronologia delle versioni
                </CardTitle>
                <CardDescription>Nulla viene mai sovrascritto.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border-subtle">
                  {versions.map((version) => {
                    const origine = ORIGINE[version.origin];
                    const corrente = version.id === chapter?.current_version_id;
                    return (
                      <li
                        key={version.id}
                        className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-xs"
                      >
                        <span className="font-mono font-medium text-foreground">
                          v{version.version_no}
                        </span>
                        <Badge tone={origine.tone}>{origine.label}</Badge>
                        {corrente ? <Badge tone="success">corrente</Badge> : null}
                        <span className="ml-auto text-muted-foreground">
                          {version.word_count.toLocaleString('it-IT')} parole
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </aside>
        </div>
      )}
    </main>
  );
}
