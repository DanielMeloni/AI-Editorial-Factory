import type { ReactNode } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { requireUser } from '@/lib/auth/guards';

/**
 * Layout delle aree private.
 * Il proxy filtra le richieste, ma la verifica viene ripetuta qui: e' questo
 * il punto in cui i dati vengono effettivamente letti.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();

  return (
    <div className="flex min-h-dvh bg-surface-muted">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
