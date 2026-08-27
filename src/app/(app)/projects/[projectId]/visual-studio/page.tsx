import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { VisualStudio } from '@/components/visual/visual-studio';
import { getProject } from '@/lib/projects/queries';
import { listProjectAssets, signAssetUrls } from '@/lib/visual/queries';
import { isFullyMocked } from '@/lib/ai/registry';

export default async function VisualStudioPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const assets = await listProjectAssets(projectId);
  const urls = await signAssetUrls(assets);

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Visual Studio"
        description="Diagrammi esatti, illustrazioni concettuali e schermate reali di procedura o risultato. Nessun asset entra nell’opera senza approvazione."
      />

      <VisualStudio
        projectId={projectId}
        assets={assets}
        signedUrls={Object.fromEntries(urls)}
        mocked={isFullyMocked()}
      />
    </main>
  );
}
