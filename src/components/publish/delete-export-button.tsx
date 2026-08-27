'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { deleteExport } from '@/lib/publish/actions';

export function DeleteExportButton({ exportId, label }: { exportId: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function elimina() {
    startTransition(async () => {
      const esito = await deleteExport(exportId);
      if (esito.ok) {
        toast.success(esito.message);
        setConfirming(false);
        router.refresh();
      } else {
        toast.error(esito.message);
      }
    });
  }

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-danger hover:text-danger"
        onClick={() => setConfirming(true)}
        aria-label={`Elimina esportazione ${label}`}
      >
        <Trash2 aria-hidden="true" />
        Elimina
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Conferma eliminazione ${label}`}>
      <span className="text-danger text-xs">Eliminare definitivamente?</span>
      <Button variant="danger" size="sm" disabled={pending} onClick={elimina}>
        <Trash2 aria-hidden="true" />
        {pending ? 'Eliminazione…' : 'Conferma'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => setConfirming(false)}
        aria-label="Annulla eliminazione"
      >
        <X aria-hidden="true" />
        Annulla
      </Button>
    </div>
  );
}
