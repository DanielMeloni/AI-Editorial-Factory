import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ListTree } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { getProject, getProjectStructure } from '@/lib/projects/queries';
import type { ChapterRow } from '@/lib/db/types';

const KIND_LABELS: Record<string, string> = {
  front_matter: 'Apertura',
  part: 'Capitolo',
  appendix: 'Appendice',
  back_matter: 'Chiusura',
};

function ChapterRowItem({ chapter, projectId }: { chapter: ChapterRow; projectId: string }) {
  const etichetta =
    chapter.kind === 'appendix'
      ? `Appendice ${chapter.label ?? ''}`.trim()
      : chapter.number !== null
        ? `Capitolo ${chapter.number}`
        : KIND_LABELS[chapter.kind];

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border-subtle px-5 py-3">
      <span className="w-28 shrink-0 text-xs font-medium text-muted-foreground">{etichetta}</span>
      <Link
        href={`/projects/${projectId}/chapters/${chapter.id}`}
        className="min-w-0 flex-1 font-medium text-foreground hover:text-primary hover:underline"
      >
        {chapter.title}
      </Link>
      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{chapter.word_count.toLocaleString('it-IT')} parole</span>
        {chapter.code_block_count > 0 ? <span>· {chapter.code_block_count} blocchi</span> : null}
        {chapter.figure_count > 0 ? <span>· {chapter.figure_count} figure</span> : null}
        {chapter.placeholder_count > 0 ? (
          <Badge tone="warning">{chapter.placeholder_count} segnaposto</Badge>
        ) : null}
      </span>
    </li>
  );
}

export default async function StructurePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const structure = await getProjectStructure(projectId);
  const vuoto = structure.parts.length === 0 && structure.orphanChapters.length === 0;

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Struttura dell’opera"
        description={
          vuoto
            ? 'La struttura viene ricostruita al primo caricamento di un archivio.'
            : `${structure.totals.chapters} capitoli, ${structure.totals.appendices} appendici, ${structure.totals.words.toLocaleString('it-IT')} parole.`
        }
      />

      {vuoto ? (
        <EmptyState
          icon={ListTree}
          title="Struttura non ancora disponibile"
          description="Carica un archivio nella scheda Fonti: parti, capitoli e appendici verranno riconosciuti e ordinati per numero."
        />
      ) : (
        <div className="space-y-4">
          {structure.parts.map((part) => (
            <Card key={part.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {part.number !== null ? (
                    <Badge tone="info">Parte {part.number}</Badge>
                  ) : (
                    <Badge tone="neutral">{KIND_LABELS[part.kind]}</Badge>
                  )}
                  {part.title}
                </CardTitle>
                <CardDescription>
                  {part.chapters.length} element{part.chapters.length === 1 ? 'o' : 'i'}
                  {part.source_path ? ` · ${part.source_path}` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ul>
                  {part.chapters.map((chapter) => (
                    <ChapterRowItem key={chapter.id} chapter={chapter} projectId={projectId} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}

          {structure.orphanChapters.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Fuori dalle parti</CardTitle>
                <CardDescription>
                  Elementi non collocati in alcuna parte editoriale.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ul>
                  {structure.orphanChapters.map((chapter) => (
                    <ChapterRowItem key={chapter.id} chapter={chapter} projectId={projectId} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </main>
  );
}
