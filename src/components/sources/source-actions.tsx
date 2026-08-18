'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ListTree, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { searchProjectSources } from '@/lib/sources/actions';
import { startChapterAudit } from '@/lib/workflows/actions';
import type { NextStep } from '@/lib/sources/queries';
import { createManualStructure } from '@/lib/structure/actions';

/**
 * Due comandi della scheda: verificare le affermazioni, e proseguire.
 *
 * «Verifica affermazioni» esegue la stessa ricerca che gira dentro l'audit, da
 * sola: per ogni frase priva di rimando cerca la fonte fra documentazione
 * ufficiale e biblioteca. Serve quando la biblioteca cambia — si carica una
 * specifica e si vuole sapere subito che cosa sostiene, senza rieseguire un
 * audit intero. È cosa diversa da «Cerca fonti sul web», che va a cercare
 * materiale nuovo invece di collegare quello che già si ha.
 *
 * Il secondo pulsante non è un «avanti» generico: dice che cosa farà, perché
 * un comando che non dichiara il proprio effetto non si può usare con fiducia.
 */

export function SearchSourcesButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function cerca() {
    startTransition(async () => {
      const esito = await searchProjectSources(projectId);
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  return (
    <Button onClick={cerca} disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
      {pending ? 'Verifica in corso…' : 'Verifica affermazioni'}
    </Button>
  );
}

export function CreateStructureButton({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function crea() {
    startTransition(async () => {
      const result = await createManualStructure(projectId);
      if (result.ok) {
        toast.success(result.message);
        if (result.href) router.push(result.href);
      } else {
        toast.error(result.message);
      }
      router.refresh();
    });
  }

  return (
    <Button
      onClick={crea}
      disabled={!enabled || pending}
      aria-busy={pending}
      title={enabled ? 'Genera parti e capitoli dalle fonti' : 'Aggiungi almeno una fonte alla biblioteca'}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ListTree aria-hidden="true" />}
      {pending ? 'Creazione struttura…' : 'Crea struttura del manuale'}
    </Button>
  );
}

export function NextStepButton({ step }: { step: NextStep }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!step.available) {
    return (
      <Button variant="secondary" disabled title={step.detail}>
        <ArrowRight aria-hidden="true" />
        {step.label}
      </Button>
    );
  }

  function prosegui() {
    // Un audit va avviato, non aperto: è l'unica azione che fa partire un
    // lavoro invece di limitarsi a portare da qualche parte.
    if (step.action === 'avvia_audit' && step.targetId !== null) {
      startTransition(async () => {
        const esito = await startChapterAudit(step.targetId!);
        if (esito.ok) {
          toast.success(esito.message);
          if (step.href) router.push(step.href);
        } else {
          toast.error(esito.message);
        }
        router.refresh();
      });
      return;
    }

    if (step.href) router.push(step.href);
  }

  return (
    <Button variant="secondary" onClick={prosegui} disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
      {pending ? 'Avvio…' : step.label}
    </Button>
  );
}
