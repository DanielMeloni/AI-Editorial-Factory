'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Aggiornamento dal vivo dello stato di un'esecuzione.
 *
 * Non tiene una copia dei dati nel browser: ascolta i cambiamenti e chiede a
 * Next di rigenerare la pagina. La fonte resta il server — quello che vedi è
 * sempre ciò che c'è nel database, non una ricostruzione locale che potrebbe
 * discostarsene.
 *
 * Se il canale non si apre — Realtime disattivato sul progetto, rete che blocca
 * i websocket — si passa a un aggiornamento a intervallo e lo si dichiara.
 * Una pagina ferma che sembra aggiornata è peggio di una pagina che ammette di
 * arrancare.
 */

const TABELLE = ['workflow_runs', 'agent_runs', 'review_requests'] as const;

/** Quanto si aspetta l'apertura del canale prima di ripiegare. */
const ATTESA_CANALE_MS = 5_000;

/** Intervallo del ripiego. */
const INTERVALLO_RISERVA_MS = 4_000;

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
  const [riserva, setRiserva] = useState(false);

  // Il timer di accorpamento sopravvive ai render, ma non deve provocarne.
  const accorpamento = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!attiva) {
      setRiserva(false);
      return;
    }

    const supabase = createClient();
    let vivo = true;
    let sottoscritto = false;

    const aggiorna = () => {
      if (!vivo) return;
      if (accorpamento.current) clearTimeout(accorpamento.current);
      accorpamento.current = setTimeout(() => {
        if (vivo) router.refresh();
      }, ACCORPAMENTO_MS);
    };

    const canale = supabase.channel(`stato-progetto-${projectId}`);
    for (const tabella of TABELLE) {
      canale.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tabella, filter: `project_id=eq.${projectId}` },
        aggiorna,
      );
    }

    canale.subscribe((stato) => {
      if (!vivo) return;
      if (stato === 'SUBSCRIBED') {
        sottoscritto = true;
        setRiserva(false);
        // Il primo disegno può essere già vecchio di qualche istante: si
        // riallinea appena il canale è aperto.
        aggiorna();
        return;
      }
      if (stato === 'CHANNEL_ERROR' || stato === 'TIMED_OUT' || stato === 'CLOSED') {
        sottoscritto = false;
        setRiserva(true);
      }
    });

    const scadenza = setTimeout(() => {
      if (vivo && !sottoscritto) setRiserva(true);
    }, ATTESA_CANALE_MS);

    return () => {
      vivo = false;
      clearTimeout(scadenza);
      if (accorpamento.current) clearTimeout(accorpamento.current);
      void supabase.removeChannel(canale);
    };
  }, [projectId, attiva, router]);

  useEffect(() => {
    if (!attiva || !riserva) return;
    const intervallo = setInterval(() => router.refresh(), INTERVALLO_RISERVA_MS);
    return () => clearInterval(intervallo);
  }, [attiva, riserva, router]);

  if (!attiva || !riserva) return null;

  return (
    <p role="status" className="text-xs text-muted-foreground">
      Aggiornamento immediato non disponibile: la pagina si riallinea ogni{' '}
      {INTERVALLO_RISERVA_MS / 1000} secondi.
    </p>
  );
}
