'use client';

import { useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import {
  confirmCoverReference,
  deleteCoverReference,
  requestCoverReferenceTicket,
} from '@/lib/visual/actions';
import type { CoverArtworkRow } from '@/lib/visual/queries';

/**
 * Immagini da cui far partire la generazione della copertina.
 *
 * Sono materiale di direzione visuale, non asset dell'opera: non entrano nel
 * libro e non passano da un'approvazione. Servono a dire al modello «questo è
 * il registro visivo», che è la sola cosa che un prompt scritto fatica a
 * trasmettere.
 */
export function CoverReferences({
  projectId,
  references,
}: {
  projectId: string;
  references: CoverArtworkRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function carica(files: FileList | null) {
    if (!files || files.length === 0) return;

    startTransition(async () => {
      const supabase = createClient();
      let caricati = 0;

      for (const file of Array.from(files)) {
        // Il file va dal browser a Storage: non attraversa il server
        // applicativo, che per una Server Action si fermerebbe al primo
        // megabyte.
        const ticket = await requestCoverReferenceTicket({
          projectId,
          filename: file.name,
          byteSize: file.size,
          mimeType: file.type,
        });

        if (!ticket.ok) {
          toast.error(`${file.name}: ${ticket.message}`);
          continue;
        }

        const { error } = await supabase.storage
          .from(ticket.bucket)
          .uploadToSignedUrl(ticket.path, ticket.token, file);

        if (error) {
          toast.error(`${file.name}: caricamento non riuscito — ${error.message}`);
          continue;
        }

        const esito = await confirmCoverReference({
          projectId,
          assetId: ticket.assetId,
          path: ticket.path,
          filename: file.name,
        });

        if (esito.ok) caricati += 1;
        else toast.error(`${file.name}: ${esito.message}`);
      }

      if (input.current) input.current.value = '';
      if (caricati > 0) {
        toast.success(`${caricati} riferiment${caricati === 1 ? 'o caricato' : 'i caricati'}.`);
        router.refresh();
      }
    });
  }

  function rimuovi(assetId: string) {
    startTransition(async () => {
      const esito = await deleteCoverReference(assetId);
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {references.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {references.map(({ asset, signedUrl }) => (
            <li
              key={asset.id}
              className="relative size-24 overflow-hidden rounded-lg border border-border-subtle bg-surface-muted"
            >
              {signedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- URL firmato a scadenza: l'ottimizzatore di Next non può memorizzarlo
                <img
                  src={signedUrl}
                  alt={asset.title ?? 'Riferimento visivo'}
                  className="size-full object-cover"
                />
              ) : (
                <span className="flex size-full items-center justify-center p-1 text-center text-[10px] text-muted-foreground">
                  Anteprima non disponibile
                </span>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => rimuovi(asset.id)}
                aria-label={`Rimuovi ${asset.title ?? 'il riferimento'}`}
                className="absolute right-1 top-1 rounded-full bg-surface/90 p-1 text-danger hover:bg-surface"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="sr-only"
        id="riferimenti-copertina"
        onChange={(event) => carica(event.target.files)}
      />

      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => input.current?.click()}
      >
        <ImagePlus aria-hidden="true" />
        {pending ? 'Caricamento…' : 'Aggiungi riferimenti'}
      </Button>

      <p className="text-xs text-muted-foreground">
        PNG, JPEG o WebP fino a 10 MB. Ne vengono usati al massimo otto, nell’ordine di
        caricamento. Senza riferimenti la generazione parte dal solo testo.
      </p>
    </div>
  );
}
