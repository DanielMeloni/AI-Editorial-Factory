import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { CoursesPanel } from '@/components/courses/courses-panel';
import { getProject } from '@/lib/projects/queries';
import { listApprovedChapters, listCourses } from '@/lib/courses/queries';
import { getToolLogoDataUrl } from '@/lib/visual/queries';

export default async function CoursesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [courses, chapters, logoDataUrl] = await Promise.all([
    listCourses(projectId),
    listApprovedChapters(projectId),
    // Incorporato, non firmato: l'anteprima di un corso si scarica, e un
    // collegamento a scadenza si romperebbe fuori dall'applicazione.
    getToolLogoDataUrl(projectId),
  ]);

  return (
    <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Corsi"
        description="Da capitoli approvati o da un argomento: livello, formato e durata cambiano la scaletta prima ancora del testo."
      />
      <CoursesPanel
        projectId={projectId}
        courses={courses}
        chapters={chapters}
        author={project.author}
        logoHref={logoDataUrl}
      />
    </main>
  );
}
