'use client';

import { useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { confirmToolLogo, deleteToolLogo, requestToolLogoTicket } from '@/lib/visual/actions';
import type { CoverArtworkRow } from '@/lib/visual/queries';

/**
 * Logo dello strumento oggetto del progetto.
 *
 * Si carica in fase di input, con le fonti, ed è il solo elemento grafico che
 * arriva sulla copertina **così com'è**: viene composto sopra l'immagine, non
 * ridisegnato da un modello. Un marchio ridisegnato somiglia al marchio, e
 * somigliare non basta né al lettore né a chi lo possiede.
 */
export function ToolLogo({
  projectId,
  logo,
}: {
  projectId: string;
  logo: CoverArtworkRow | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function carica(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    startTransition(async () => {
      const supabase = createClient();

      const ticket = await requestToolLogoTicket({
        projectId,
        filename: file.name,
        byteSize: file.size,
        mimeType: file.type,
      });

      if (!ticket.ok) {
        toast.error(ticket.message);
        return;
      }

      // Dal browser a Storage, senza passare dal server applicativo.
      const { error } = await supabase.storage
        .from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, file);

      if (error) {
        toast.error(`Caricamento non riuscito — ${error.message}`);
        return;
      }

      const esito = await confirmToolLogo({
        projectId,
        assetId: ticket.assetId,
        path: ticket.path,
        filename: file.name,
      });

      if (input.current) input.current.value = '';
      if (esito.ok) {
        toast.success(esito.message);
        router.refresh();
      } else {
        toast.error(esito.message);
      }
    });
  }

  function rimuovi() {
    if (!logo) return;
    startTransition(async () => {
      const esito = await deleteToolLogo(logo.asset.id);
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {logo ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex h-24 w-40 items-center justify-center rounded-lg border border-border-subtle bg-[#0a1730] p-2">
            {logo.signedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL firmato a scadenza: l'ottimizzatore di Next non può memorizzarlo
              <img
                src={logo.signedUrl}
                alt={logo.asset.title ?? 'Logo dello strumento'}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="p-1 text-center text-[10px] text-muted-foreground">
                Anteprima non disponibile
              </span>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={rimuovi}
              aria-label="Rimuovi il logo"
              className="absolute right-1 top-1 rounded-full bg-surface/90 p-1 text-danger hover:bg-surface"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {logo.asset.title}
            <span className="block">
              Il fondo scuro dell’anteprima è quello della copertina: se il logo sparisce qui,
              sparirà anche lì.
            </span>
          </p>
        </div>
      ) : null}

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        id="logo-strumento"
        onChange={(event) => carica(event.target.files)}
      />

      <Button variant="secondary" disabled={pending} onClick={() => input.current?.click()}>
        <ImagePlus aria-hidden="true" />
        {pending ? 'Caricamento…' : logo ? 'Sostituisci il logo' : 'Carica il logo'}
      </Button>

      <p className="text-xs text-muted-foreground">
        PNG, JPEG o WebP fino a 10 MB. Meglio un PNG con sfondo trasparente e marchio chiaro: la
        copertina è scura. Ne resta uno solo — il nuovo sostituisce il precedente.
      </p>
    </div>
  );
}
