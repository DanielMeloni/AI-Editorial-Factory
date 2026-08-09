import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Topbar } from '@/components/layout/topbar';
import { ProjectTabs } from '@/components/projects/project-tabs';
import { requireUser } from '@/lib/auth/guards';
import { getProject } from '@/lib/projects/queries';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireUser();
  const project = await getProject(projectId);

  // La RLS impedisce già di leggere progetti altrui: qui il risultato nullo
  // diventa un 404, senza rivelare se il progetto esista in un'altra organizzazione.
  if (!project) notFound();

  return (
    <>
      <Topbar
        email={user.email}
        crumbs={[{ label: 'Progetti', href: '/projects' }, { label: project.title }]}
      />
      <div className="border-b border-border-subtle bg-surface px-4 sm:px-6">
        <ProjectTabs projectId={projectId} />
      </div>
      {children}
    </>
  );
}
