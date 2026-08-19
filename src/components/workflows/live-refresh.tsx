'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Aggiornamento dal vivo dello stato di un'esecuzione.
 *
 * Non tiene una copia dei dati nel browser: ascolta i cambiamenti e chiede a
 * Next di rigenerare la pagina. La fonte resta il server — quello che vedi è
 * sempre ciò che c'è nel database, non una ricostruzione locale.
 *
 * Due meccanismi insieme, e non è ridondanza:
 *
 *  - Un **controllo periodico** garantisce che la pagina non resti mai ferma.
 *  - Un **canale Realtime** rende l'aggiornamento immediato quando funziona.
 *
 * La prima versione si affidava al solo canale, con il controllo periodico come
 * ripiego se il canale non si apriva. Era sbagliato: il canale si apre anche
 * quando le tabelle non sono pubblicate su Realtime, e in quel caso non arriva
 * mai nulla mentre tutto sembra a posto. «Sottoscritto» non significa
 * «riceverò»: l'unica garanzia è chiedere.
 *
 * Quando gli eventi arrivano davvero, il controllo periodico si dirada: serve
 * come rete, non come motore.
 */

const TABELLE = ['workflow_runs', 'agent_runs', 'review_requests'] as const;

/** Ritmo del controllo quando il canale non porta nulla. */
const INTERVALLO_BASE_MS = 3_000;
/** Ritmo quando gli eventi arrivano: la rete resta, ma larga. */
const INTERVALLO_RILASSATO_MS = 20_000;
/** Silenzio dopo il quale si torna al ritmo serrato. */
const SILENZIO_MS = 30_000;
/** I cambiamenti arrivano a raffica: si accorpano prima di ridisegnare. */
const ACCORPAMENTO_MS = 400;

export function LiveRefresh({
  projectId,
  attiva,
}: {
  projectId: string;
  /** Falso quando non c'è nulla in corso: non si ascolta e non si interroga. */
  attiva: boolean;
}) {
  const router = useRouter();
  const [dalVivo, setDalVivo] = useState(false);

  const accorpamento = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimoEvento = useRef<number>(0);

  const aggiorna = useCallback(() => {
    if (accorpamento.current) clearTimeout(accorpamento.current);
    accorpamento.current = setTimeout(() => router.refresh(), ACCORPAMENTO_MS);
  }, [router]);

  // --- Canale: aggiornamento immediato quando disponibile -------------------
  useEffect(() => {
    if (!attiva) {
      setDalVivo(false);
      return;
    }

    const supabase = createClient();
    let vivo = true;

    const canale = supabase.channel(`stato-progetto-${projectId}`);
    for (const tabella of TABELLE) {
      canale.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tabella, filter: `project_id=eq.${projectId}` },
        () => {
          if (!vivo) return;
          // È il primo segnale che il canale non è soltanto aperto: porta dati.
          ultimoEvento.current = Date.now();
          setDalVivo(true);
          aggiorna();
        },
      );
    }

    canale.subscribe();

    return () => {
      vivo = false;
      if (accorpamento.current) clearTimeout(accorpamento.current);
      void supabase.removeChannel(canale);
    };
  }, [projectId, attiva, aggiorna]);

  // --- Controllo periodico: la garanzia ------------------------------------
  useEffect(() => {
    if (!attiva) return;

    const intervallo = setInterval(
      () => {
        // Se il canale tace da un po', si torna al ritmo serrato: può essersi
        // chiuso senza dirlo.
        if (dalVivo && Date.now() - ultimoEvento.current > SILENZIO_MS) setDalVivo(false);
        router.refresh();
      },
      dalVivo ? INTERVALLO_RILASSATO_MS : INTERVALLO_BASE_MS,
    );

    return () => clearInterval(intervallo);
  }, [attiva, dalVivo, router]);

  if (!attiva) return null;

  return (
    <p role="status" className="text-xs text-muted-foreground">
      {dalVivo
        ? 'Aggiornamento immediato attivo.'
        : `Aggiornamento ogni ${INTERVALLO_BASE_MS / 1000} secondi.`}
    </p>
  );
}
