'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BookMarked } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { rebuildBibliography } from '@/lib/bibliography/actions';

/**
 * Ricostruzione della bibliografia.
 *
 * È un'azione esplicita e non un effetto collaterale: le fonti si aggiungono in
 * momenti diversi — dalla scheda Fonti, dalle proposte accettate in un audit —
 * e chi scrive decide quando l'elenco è pronto per essere fissato in una nuova
 * versione del capitolo.
 */
export function RebuildBibliographyButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const esito = await rebuildBibliography(projectId);
          if (esito.ok) toast.success(esito.message);
          else toast.error(esito.message);
          router.refresh();
        })
      }
    >
      <BookMarked aria-hidden="true" />
      {pending ? 'Aggiornamento…' : 'Aggiorna la bibliografia'}
    </Button>
  );
}
