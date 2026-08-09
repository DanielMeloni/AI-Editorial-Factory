'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Il messaggio completo resta nei log del server: qui niente dettagli tecnici.
    console.error('Errore non gestito', error.digest ?? error.message);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="w-full max-w-md space-y-4">
        <Alert tone="danger" title="Si è verificato un errore">
          L’operazione non è andata a buon fine. Riprova; se il problema persiste, segnala il codice
          {error.digest ? ` ${error.digest}` : ''}.
        </Alert>
        <Button onClick={reset} block>
          Riprova
        </Button>
      </div>
    </main>
  );
}
