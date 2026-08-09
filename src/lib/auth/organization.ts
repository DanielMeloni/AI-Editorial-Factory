import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import type { MemberRole, OrganizationRow } from '@/lib/db/types';

export interface CurrentOrganization {
  id: string;
  name: string;
  slug: string;
  role: MemberRole;
}

/**
 * Organizzazione attiva dell'utente.
 *
 * Nell'MVP un utente appartiene a una sola organizzazione, creata dal trigger
 * alla registrazione. La funzione esiste comunque perché ogni dato editoriale è
 * già legato a un'organizzazione: quando arriveranno gli inviti, cambierà solo
 * il modo di scegliere quale, non il resto del codice.
 */
export async function getCurrentOrganization(): Promise<CurrentOrganization | null> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('organization_members')
    .select('role, organizations!inner(id, name, slug, is_personal)')
    .order('created_at', { ascending: true })
    .limit(1)
    .returns<{ role: MemberRole; organizations: OrganizationRow }[]>();

  if (error || !data || data.length === 0) return null;

  const membership = data[0]!;
  return {
    id: membership.organizations.id,
    name: membership.organizations.name,
    slug: membership.organizations.slug,
    role: membership.role,
  };
}

/** Come sopra, ma fallisce invece di restituire null. */
export async function requireOrganization(): Promise<CurrentOrganization> {
  const organization = await getCurrentOrganization();
  if (!organization) {
    throw new Error(
      'Nessuna organizzazione associata all’account. Verifica che il trigger di provisioning sia attivo su Supabase.',
    );
  }
  return organization;
}
