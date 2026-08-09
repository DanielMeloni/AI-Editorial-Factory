'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

/**
 * Confine di errore dell'applicazione.
 *
 * In produzione Next.js sostituisce il messaggio con un `digest`, per non
 * esporre dettagli interni al browser. In sviluppo il messaggio reale è invece
 * disponibile, e nasconderlo servirebbe solo a costringere chi sviluppa a
 * cercarlo altrove.
 *
 * Il digest resta utile per correlare la schermata alla riga nei log del
 * server: è la stessa stringa che compare in entrambi.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const inSviluppo = process.env.NODE_ENV === 'development';

  useEffect(() => {
    console.error('Errore non gestito', error.digest ?? error.message);
  }, [error]);

  // Le cause più frequenti in prima installazione, riconosciute dal messaggio.
  const messaggio = error.message ?? '';
  const suggerimento = riconosciCausa(messaggio);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 py-12">
      <div className="w-full max-w-2xl space-y-4">
        <Alert tone="danger" title="Si è verificato un errore">
          L’operazione non è andata a buon fine.
          {error.digest ? (
            <>
              {' '}
              Codice: <code className="font-mono text-xs">{error.digest}</code> — lo stesso codice
              compare nei log del server, accanto al messaggio completo.
            </>
          ) : null}
        </Alert>

        {suggerimento ? (
          <Alert tone="info" title={suggerimento.titolo}>
            {suggerimento.testo}
          </Alert>
        ) : null}

        {inSviluppo && messaggio ? (
          <details className="rounded-lg border border-border-subtle bg-surface-muted p-3" open>
            <summary className="cursor-pointer text-sm font-medium">
              Dettaglio tecnico (visibile solo in sviluppo)
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
              <code>{messaggio}</code>
            </pre>
          </details>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={reset}>Riprova</Button>
          <Link href="/diagnostica" className={buttonVariants({ variant: 'secondary' })}>
            Verifica la configurazione
          </Link>
          <Link href="/dashboard" className={buttonVariants({ variant: 'ghost' })}>
            Torna alla dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

/**
 * Traduce gli errori più frequenti in una causa comprensibile.
 *
 * Sono tutti riconducibili a una configurazione incompleta: capitano una volta
 * sola, in prima installazione, e senza un indizio costano un'ora.
 */
function riconosciCausa(messaggio: string): { titolo: string; testo: string } | null {
  const testo = messaggio.toLowerCase();

  if (/relation .* does not exist|schema cache|pgrst205/.test(testo)) {
    return {
      titolo: 'Le tabelle non esistono ancora',
      testo:
        'Il database non ha lo schema dell’applicazione. Applica le migration con ' +
        '`npx supabase db push`, oppure incolla supabase/setup-completo.sql nell’SQL Editor.',
    };
  }

  if (/configurazione (pubblica|server) non valida|next_public_supabase/.test(testo)) {
    return {
      titolo: 'Configurazione incompleta',
      testo:
        'Manca una variabile di ambiente. Esegui `npm run check:env`: elenca ciò che manca senza ' +
        'stampare alcun valore.',
    };
  }

  if (/nessuna organizzazione/.test(testo)) {
    return {
      titolo: 'Account senza organizzazione',
      testo:
        'Il trigger che crea profilo e organizzazione alla registrazione non è stato applicato. ' +
        'Verifica che la migration 02 sia presente nel progetto Supabase, poi registra un nuovo account.',
    };
  }

  if (/service_role/.test(testo)) {
    return {
      titolo: 'Chiave di servizio assente',
      testo:
        'SUPABASE_SERVICE_ROLE_KEY non è configurata: gli step dei workflow non possono scrivere. ' +
        'Aggiungila a .env.local e riavvia il server.',
    };
  }

  if (/fetch failed|econnrefused|enotfound/.test(testo)) {
    return {
      titolo: 'Supabase non raggiungibile',
      testo:
        'La connessione al progetto Supabase è fallita. Controlla NEXT_PUBLIC_SUPABASE_URL e che ' +
        'il progetto non sia in pausa.',
    };
  }

  return null;
}
