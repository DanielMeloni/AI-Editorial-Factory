import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { BlogPanel } from '@/components/blog/blog-panel';
import { getProject } from '@/lib/projects/queries';
import { getLatestBlogPlan } from '@/lib/blog/queries';

export default async function BlogPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const plan = await getLatestBlogPlan(projectId);

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Blog"
        description="Articoli derivati dal manuale approvato, ottimizzati per i motori di ricerca e per i sistemi che rispondono citando."
      />
      <BlogPanel projectId={projectId} plan={plan} />
    </main>
  );
}
