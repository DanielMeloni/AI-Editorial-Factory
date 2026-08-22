import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { CoverStudio } from '@/components/visual/cover-studio';
import { getProject, listProjectVolumes } from '@/lib/projects/queries';
import { getCover, getCoverDefaults, getToolLogo, listCoverArtwork, listCoverReferences } from '@/lib/visual/queries';

export default async function CoverStudioPage({
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
  const volumes = await listProjectVolumes(projectId);
  const selectedVolume = volumes.find((volume) => volume.id === requestedVolume) ?? volumes[0] ?? null;

  const [cover, defaults, artwork, references, logo] = await Promise.all([
    getCover(projectId),
    getCoverDefaults(projectId, selectedVolume?.id),
    listCoverArtwork(projectId),
    listCoverReferences(projectId),
    getToolLogo(projectId),
  ]);

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Cover Studio"
        description="Fronte, dorso e quarta di copertina, con specifiche di stampa e calcolo del dorso."
      />

      <CoverStudio
        key={selectedVolume?.id ?? 'project'}
        projectId={projectId}
        volumeId={selectedVolume?.id ?? null}
        cover={cover}
        artwork={artwork}
        references={references}
        logo={logo}
        defaults={defaults}
      />
    </main>
  );
}
