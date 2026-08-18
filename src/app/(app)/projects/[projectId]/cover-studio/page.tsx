import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { CoverStudio } from '@/components/visual/cover-studio';
import { getProject } from '@/lib/projects/queries';
import { getCover, listCoverArtwork, listCoverReferences } from '@/lib/visual/queries';

export default async function CoverStudioPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [cover, artwork, references] = await Promise.all([
    getCover(projectId),
    listCoverArtwork(projectId),
    listCoverReferences(projectId),
  ]);

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Cover Studio"
        description="Fronte, dorso e quarta di copertina, con specifiche di stampa e calcolo del dorso."
      />

      <CoverStudio
        projectId={projectId}
        cover={cover}
        artwork={artwork}
        references={references}
        defaults={{ title: project.title, subtitle: project.subtitle, author: project.author }}
      />
    </main>
  );
}
