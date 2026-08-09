'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getExportDownloadUrl } from '@/lib/publish/actions';

/**
 * Il file non è raggiungibile da un URL statico: sta in un bucket privato.
 * Il collegamento viene chiesto al momento del clic e scade in due minuti.
 */
export function DownloadButton({ exportId, label }: { exportId: string; label: string }) {
  const [pending, setPending] = useState(false);

  async function scarica() {
    setPending(true);
    try {
      const url = await getExportDownloadUrl(exportId);
      if (!url) {
        toast.error('Download non disponibile: il file potrebbe non essere pronto.');
        return;
      }
      window.location.href = url;
    } catch {
      toast.error('Richiesta del collegamento non riuscita.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Button size="sm" variant="secondary" onClick={scarica} disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
      {label}
    </Button>
  );
}
