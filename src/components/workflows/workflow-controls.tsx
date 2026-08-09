'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Play, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cancelWorkflow, retryWorkflow, startChapterAudit } from '@/lib/workflows/actions';

type Comando = 'start' | 'cancel' | 'retry';

const ICONE = { start: Play, cancel: XCircle, retry: RotateCcw } as const;

const ETICHETTE: Record<Comando, { azione: string; corso: string }> = {
  start: { azione: 'Avvia audit tecnico', corso: 'Avvio…' },
  cancel: { azione: 'Annulla', corso: 'Annullamento…' },
  retry: { azione: 'Ritenta', corso: 'Nuovo tentativo…' },
};

export function WorkflowControls({
  comando,
  targetId,
  variant = 'primary',
  disabled = false,
  disabledReason,
}: {
  comando: Comando;
  targetId: string;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [locale, setLocale] = useState(false);

  const Icona = ICONE[comando];
  const inCorso = pending || locale;

  function esegui() {
    setLocale(true);
    startTransition(async () => {
      try {
        const esito =
          comando === 'start'
            ? await startChapterAudit(targetId)
            : comando === 'cancel'
              ? await cancelWorkflow(targetId)
              : await retryWorkflow(targetId);

        if (esito.ok) toast.success(esito.message);
        else toast.error(esito.message);
        router.refresh();
      } catch (error) {
        toast.error((error as Error).message || 'Operazione non riuscita.');
      } finally {
        setLocale(false);
      }
    });
  }

  return (
    <Button
      variant={variant}
      onClick={esegui}
      disabled={disabled || inCorso}
      aria-busy={inCorso}
      title={disabled ? disabledReason : undefined}
    >
      <Icona aria-hidden="true" />
      {inCorso ? ETICHETTE[comando].corso : ETICHETTE[comando].azione}
      {disabled && disabledReason ? <span className="sr-only">{disabledReason}</span> : null}
    </Button>
  );
}
