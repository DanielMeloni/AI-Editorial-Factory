import type { Metadata } from 'next';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { CreateProjectForm } from '@/components/projects/create-project-form';
import { requireUser } from '@/lib/auth/guards';

export const metadata: Metadata = { title: 'Nuovo progetto' };

export default async function NewProjectPage() {
  const user = await requireUser();

  return (
    <>
      <Topbar
        email={user.email}
        crumbs={[{ label: 'Progetti', href: '/projects' }, { label: 'Nuovo' }]}
      />

      <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
        <PageHeader
          title="Nuovo progetto editoriale"
          description="Dati identificativi dell'opera. Potrai modificarli in seguito."
        />

        <Card>
          <CardContent className="p-5">
            <CreateProjectForm />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
