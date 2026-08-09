import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getServerEnv } from '@/lib/env';

export interface AuditEntry {
  organizationId: string | null;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Registra un'azione sensibile.
 *
 * La tabella `audit_log` non ha policy di INSERT: il client non può scriverci,
 * per costruzione. La scrittura passa dal service role, che ignora la RLS.
 *
 * Un audit non riuscito non deve mai far fallire l'operazione dell'utente:
 * l'errore viene annotato nei log del server e basta.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  if (!getServerEnv().SUPABASE_SERVICE_ROLE_KEY) return;

  try {
    const admin = createAdminClient();
    await admin.from('audit_log').insert({
      organization_id: entry.organizationId,
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (error) {
    console.warn('Registrazione audit non riuscita:', (error as Error).message);
  }
}
