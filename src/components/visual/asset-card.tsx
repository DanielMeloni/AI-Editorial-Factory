'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Eye, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { decideAsset } from '@/lib/visual/actions';
import type { AssetRow } from '@/lib/visual/queries';
import { MermaidDiagram } from '@/components/visual/mermaid-diagram';

const STATO = {
  draft: { label: 'bozza', tone: 'neutral' },
  pending_approval: { label: 'da approvare', tone: 'warning' },
  approved: { label: 'approvato', tone: 'success' },
  rejected: { label: 'rifiutato', tone: 'danger' },
  superseded: { label: 'superato', tone: 'neutral' },
} as const;

const GENERATORE = {
  mermaid: 'Mermaid (deterministico)',
  svg: 'SVG (deterministico)',
  ai: 'Modello visuale',
  upload: 'Caricato',
} as const;

export function AssetCard({
  asset,
  signedUrl,
  onSelectVariant,
  onPreview,
  inAnteprima = false,
}: {
  asset: AssetRow;
  signedUrl?: string;
  onSelectVariant?: (asset: AssetRow) => void;
  /** Presente dove l'asset può essere provato prima di essere deciso. */
  onPreview?: (asset: AssetRow) => void;
  inAnteprima?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erroreImmagine, setErroreImmagine] = useState(false);

  const stato = STATO[asset.status as keyof typeof STATO] ?? STATO.draft;
  const daDecidere = asset.status === 'pending_approval';

  function decidi(decision: 'approved' | 'rejected') {
    startTransition(async () => {
      const esito = await decideAsset(asset.id, decision);
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  return (
    <Card className="flex h-full flex-col">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-t-card border-b border-border-subtle bg-surface-muted">
        {signedUrl && !erroreImmagine ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmato a scadenza: l'ottimizzatore di Next non può memorizzarlo
          <img
            src={signedUrl}
            alt={asset.alt_text ?? asset.caption ?? 'Illustrazione generata'}
            className="size-full object-cover"
            onError={() => setErroreImmagine(true)}
          />
        ) : asset.mermaid_source ? (
          <MermaidDiagram
            source={asset.mermaid_source}
            title={asset.title}
            mostraSorgente={false}
            className="size-full overflow-auto p-2 [&>div]:border-0 [&>div]:bg-transparent"
          />
        ) : (
          <span className="px-4 text-center text-xs text-muted-foreground">
            {erroreImmagine ? 'Immagine non caricabile: verifica Storage.' : 'Anteprima non disponibile'}
          </span>
        )}
      </div>

      <CardContent className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={stato.tone}>{stato.label}</Badge>
          <Badge tone="neutral">v{asset.version}</Badge>
          {asset.generator === 'ai' ? <Badge tone="info">AI</Badge> : <Badge tone="accent">esatto</Badge>}
        </div>

        <p className="text-sm font-medium text-foreground">{asset.title ?? 'Senza titolo'}</p>
        {asset.caption ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{asset.caption}</p>
        ) : null}

        <dl className="mt-auto space-y-0.5 text-[11px] text-muted-foreground">
          <div className="flex gap-1">
            <dt>Origine:</dt>
            <dd>{GENERATORE[asset.generator as keyof typeof GENERATORE] ?? asset.generator}</dd>
          </div>
          {asset.model ? (
            <div className="flex gap-1">
              <dt>Modello:</dt>
              <dd className="truncate">{asset.model}</dd>
            </div>
          ) : null}
          {asset.seed !== null ? (
            <div className="flex gap-1">
              <dt>Seme:</dt>
              <dd className="font-mono">{asset.seed}</dd>
            </div>
          ) : null}
          {asset.width && asset.height ? (
            <div className="flex gap-1">
              <dt>Dimensioni:</dt>
              <dd>{asset.width}×{asset.height}</dd>
            </div>
          ) : null}
          <div className="flex gap-1">
            <dt>Costo:</dt>
            <dd>{asset.cost_usd > 0 ? `$${Number(asset.cost_usd).toFixed(4)}` : 'nessuno'}</dd>
          </div>
        </dl>

        {asset.alt_text ? (
          <p className="rounded bg-surface-muted p-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium">Alt:</span> {asset.alt_text}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-1.5 pt-1">
          {daDecidere ? (
            <>
              <Button size="sm" disabled={pending} onClick={() => decidi('approved')}>
                <Check aria-hidden="true" />
                Approva
              </Button>
              <Button size="sm" variant="danger" disabled={pending} onClick={() => decidi('rejected')}>
                <X aria-hidden="true" />
                Rifiuta
              </Button>
            </>
          ) : null}

          {onPreview ? (
            <Button
              size="sm"
              variant={inAnteprima ? 'primary' : 'secondary'}
              aria-pressed={inAnteprima}
              onClick={() => onPreview(asset)}
            >
              <Eye aria-hidden="true" />
              {inAnteprima ? 'In anteprima' : 'Vedi in anteprima'}
            </Button>
          ) : null}

          {asset.generator === 'ai' && onSelectVariant ? (
            <Button size="sm" variant="secondary" onClick={() => onSelectVariant(asset)}>
              <Copy aria-hidden="true" />
              Genera variante
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
