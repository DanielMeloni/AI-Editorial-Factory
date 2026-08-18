'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MermaidDiagram } from '@/components/visual/mermaid-diagram';
import { decideAsset } from '@/lib/visual/actions';
import type { VisualAssetRow } from '@/lib/workflows/queries';

/**
 * Approvazione delle figure dentro la revisione del capitolo.
 *
 * Testo e figure appartengono alla stessa decisione editoriale e vengono
 * giudicati insieme: separarli costringerebbe a ricostruire a memoria, in
 * un'altra pagina, il contesto appena letto.
 *
 * Le due decisioni restano però distinte nel merito — approvare la revisione
 * del testo non approva le figure, e viceversa. Ognuna ha il suo pulsante e la
 * sua traccia.
 */

const STATO = {
  draft: { label: 'bozza', tone: 'neutral' },
  pending_approval: { label: 'da approvare', tone: 'warning' },
  approved: { label: 'approvato', tone: 'success' },
  rejected: { label: 'rifiutato', tone: 'danger' },
  superseded: { label: 'superato', tone: 'neutral' },
} as const;

export function AssetApproval({
  assets,
  readOnly,
}: {
  assets: VisualAssetRow[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function decidi(assetId: string, decision: 'approved' | 'rejected') {
    startTransition(async () => {
      const esito = await decideAsset(assetId, decision);
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  if (assets.length === 0) {
    return <p className="text-sm text-muted-foreground">Nessuna figura proposta per questo capitolo.</p>;
  }

  return (
    <ul className="space-y-5">
      {assets.map((asset) => {
        const stato = STATO[asset.status as keyof typeof STATO] ?? STATO.draft;
        const daDecidere = asset.status === 'pending_approval' && !readOnly;

        return (
          <li key={asset.id} className="space-y-2 border-t border-border-subtle pt-4 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {asset.title ?? 'Senza titolo'}
              </span>
              <Badge tone={stato.tone}>{stato.label}</Badge>
              <Badge tone="neutral">v{asset.version}</Badge>
              {asset.generator === 'ai' ? (
                <Badge tone="info">AI</Badge>
              ) : (
                <Badge tone="accent">esatto</Badge>
              )}
            </div>

            {asset.caption ? (
              <p className="text-xs text-muted-foreground">{asset.caption}</p>
            ) : null}

            {asset.mermaid_source ? (
              <MermaidDiagram source={asset.mermaid_source} title={asset.title} />
            ) : (
              <p className="rounded-lg border border-border-subtle bg-surface-muted p-3 text-xs text-muted-foreground">
                Questa figura non è un diagramma: l’anteprima richiede un collegamento firmato e si
                apre dalla scheda del capitolo. Qui puoi comunque decidere.
              </p>
            )}

            {asset.alt_text ? (
              <p className="rounded-lg bg-surface-muted p-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Alt:</span> {asset.alt_text}
              </p>
            ) : (
              <p className="text-xs text-warning">
                Testo alternativo assente: senza, la figura non è accessibile.
              </p>
            )}

            {daDecidere ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={pending} onClick={() => decidi(asset.id, 'approved')}>
                  <Check aria-hidden="true" />
                  Approva la figura
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => decidi(asset.id, 'rejected')}
                >
                  <X aria-hidden="true" />
                  Rifiuta
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
