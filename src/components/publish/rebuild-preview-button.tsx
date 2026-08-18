'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { rebuildVolumePreview } from '@/lib/publish/actions';

/**
 * Ricostruzione manuale dell'anteprima.
 *
 * Il workflow la aggiorna da solo a ogni capitolo convalidato: questo pulsante
 * serve quando è cambiato qualcosa fuori dal workflow — una modifica manuale,
 * la bibliografia rigenerata — e si vuole rivedere il volume senza avviare un
 * audit.
 */
export function RebuildPreviewButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const esito = await rebuildVolumePreview(projectId);
          if (esito.ok) toast.success(esito.message);
          else toast.error(esito.message);
          router.refresh();
        })
      }
    >
      <RefreshCw aria-hidden="true" />
      {pending ? 'Composizione…' : 'Ricomponi l’anteprima'}
    </Button>
  );
}
