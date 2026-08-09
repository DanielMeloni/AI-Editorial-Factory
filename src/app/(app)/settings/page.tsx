import type { Metadata } from 'next';
import { Topbar } from '@/components/layout/topbar';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProfileForm } from '@/components/auth/profile-form';
import { requireUser } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { COMING_SOON_LABEL } from '@/lib/navigation/items';

export const metadata: Metadata = { title: 'Impostazioni' };

export default async function SettingsPage() {
  const user = await requireUser();

  // getUser() restituisce il record aggiornato dal server di autenticazione,
  // necessario per leggere i metadati del profilo.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const metadata = data.user?.user_metadata as { full_name?: unknown } | undefined;
  const fullName = typeof metadata?.full_name === 'string' ? metadata.full_name : '';

  return (
    <>
      <Topbar email={user.email} crumbs={[{ label: 'Impostazioni' }]} />

      <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
        <PageHeader title="Impostazioni" description="Profilo personale e configurazione." />

        <Card>
          <CardHeader>
            <CardTitle>Profilo</CardTitle>
            <CardDescription>Dati visibili all’interno dell’organizzazione.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm fullName={fullName} email={user.email ?? ''} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Organizzazione
              <Badge tone="neutral">{COMING_SOON_LABEL}</Badge>
            </CardTitle>
            <CardDescription>
              Membri, ruoli e permessi. Le organizzazioni vengono introdotte con lo schema del
              database nella Fase 2.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Provider AI
              <Badge tone="neutral">{COMING_SOON_LABEL}</Badge>
            </CardTitle>
            <CardDescription>
              Selezione di modello testuale e visuale, modalità mock e limiti di spesa. Arriva con la
              Fase 3.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    </>
  );
}
