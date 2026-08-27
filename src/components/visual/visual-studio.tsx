'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { AssetCard } from './asset-card';
import { generateIllustration } from '@/lib/visual/actions';
import { EditorialCapture } from './editorial-capture';
import type { AssetRow } from '@/lib/visual/queries';

const FILTRI = [
  { key: 'tutti', label: 'Tutti' },
  { key: 'pending_approval', label: 'Da approvare' },
  { key: 'approved', label: 'Approvati' },
  { key: 'diagram', label: 'Diagrammi' },
  { key: 'illustration', label: 'Illustrazioni' },
  { key: 'capture', label: 'Schermate' },
] as const;

type Filtro = (typeof FILTRI)[number]['key'];

export function VisualStudio({
  projectId,
  assets,
  signedUrls,
  mocked,
}: {
  projectId: string;
  assets: AssetRow[];
  signedUrls: Record<string, string>;
  mocked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filtro, setFiltro] = useState<Filtro>('tutti');

  const [prompt, setPrompt] = useState('');
  const [negativo, setNegativo] = useState('');
  const [didascalia, setDidascalia] = useState('');
  const [alt, setAlt] = useState('');
  const [stile, setStile] = useState('');
  const [larghezza, setLarghezza] = useState(1024);
  const [altezza, setAltezza] = useState(768);
  const [seme, setSeme] = useState<string>('');
  const [padre, setPadre] = useState<AssetRow | null>(null);

  const visibili = assets.filter((asset) => {
    if (filtro === 'tutti') return true;
    if (filtro === 'capture') return asset.capture_source === 'ui_capture';
    if (filtro === 'diagram' || filtro === 'illustration') return asset.kind === filtro && asset.capture_source !== 'ui_capture';
    return asset.status === filtro;
  });

  const daApprovare = assets.filter((a) => a.status === 'pending_approval').length;

  function genera() {
    startTransition(async () => {
      const esito = await generateIllustration({
        projectId,
        chapterId: padre?.chapter_id ?? null,
        prompt,
        negativePrompt: negativo || null,
        width: larghezza,
        height: altezza,
        style: stile || null,
        caption: didascalia,
        altText: alt,
        parentAssetId: padre?.id ?? null,
        seed: seme.trim() === '' ? null : Number(seme),
      });

      if (esito.ok) {
        toast.success(esito.message);
        setPadre(null);
        router.refresh();
      } else {
        toast.error(esito.message);
      }
    });
  }

  return (
    <div className="space-y-6">
      {mocked ? (
        <Alert tone="info" title="Provider visuale in modalità mock">
          Le immagini sono generate localmente, in modo deterministico, senza consumare crediti.
          Servono a percorrere per intero generazione, varianti e approvazione. Gli adapter verso
          provider reali si configurano da <code>AI_IMAGE_PROVIDER</code>.
        </Alert>
      ) : null}

      <EditorialCapture projectId={projectId} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
            Genera un’illustrazione
            {padre ? <Badge tone="info">variante di v{padre.version}</Badge> : null}
          </CardTitle>
          <CardDescription>
            Le illustrazioni sono concettuali. I diagrammi tecnici — DAG, flussi, architetture — non
            si generano qui: nascono dal codice, esatti per costruzione.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <Field
            id="prompt"
            label="Descrizione dell’immagine"
            hint="Nessun testo dentro l’immagine: titoli e didascalie vengono composti sopra, per restare leggibili."
            required
          >
            {({ id, describedBy }) => (
              <textarea
                id={id}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={3}
                aria-describedby={describedBy}
                className="w-full rounded-lg border border-border-strong bg-surface p-2 text-sm"
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="negativo" label="Da evitare" hint="Elementi che non devono comparire.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={negativo}
                  onChange={(event) => setNegativo(event.target.value)}
                  aria-describedby={describedBy}
                />
              )}
            </Field>

            <Field id="stile" label="Stile" hint="Coerente con la collana.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={stile}
                  onChange={(event) => setStile(event.target.value)}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="didascalia" label="Didascalia" required>
              {({ id }) => (
                <Input
                  id={id}
                  value={didascalia}
                  onChange={(event) => setDidascalia(event.target.value)}
                />
              )}
            </Field>

            <Field
              id="alt"
              label="Testo alternativo"
              hint="Obbligatorio: descrive l’immagine a chi non può vederla."
              required
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={alt}
                  onChange={(event) => setAlt(event.target.value)}
                  aria-describedby={describedBy}
                  invalid={alt.trim().length === 0 && prompt.length > 0}
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="larghezza" label="Larghezza (px)">
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={128}
                  max={2048}
                  value={larghezza}
                  onChange={(event) => setLarghezza(Number(event.target.value))}
                />
              )}
            </Field>
            <Field id="altezza" label="Altezza (px)">
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={128}
                  max={2048}
                  value={altezza}
                  onChange={(event) => setAltezza(Number(event.target.value))}
                />
              )}
            </Field>
            <Field id="seme" label="Seme" hint="Lascia vuoto per derivarlo dal prompt.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={seme}
                  onChange={(event) => setSeme(event.target.value.replace(/[^0-9]/g, ''))}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending || prompt.trim().length < 10 || alt.trim().length === 0}
              onClick={genera}
            >
              <Sparkles aria-hidden="true" />
              {pending ? 'Generazione…' : 'Genera'}
            </Button>
            {padre ? (
              <Button variant="ghost" onClick={() => setPadre(null)}>
                Annulla variante
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {FILTRI.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filtro === f.key}
            onClick={() => setFiltro(f.key)}
            className={
              filtro === f.key
                ? 'rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary'
                : 'rounded-full px-3 py-1 text-sm text-muted-foreground hover:bg-surface-muted'
            }
          >
            {f.label}
            {f.key === 'pending_approval' && daApprovare > 0 ? ` (${daApprovare})` : ''}
          </button>
        ))}
      </div>

      {visibili.length === 0 ? (
        <EmptyState
          title="Nessun asset"
          description={
            filtro === 'tutti'
              ? 'Genera un’illustrazione, oppure avvia l’audit di un capitolo per ottenere i diagrammi.'
              : 'Nessun asset corrisponde al filtro selezionato.'
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibili.map((asset) => (
            <li key={asset.id}>
              <AssetCard
                asset={asset}
                signedUrl={signedUrls[asset.id]}
                onSelectVariant={(selezionato) => {
                  setPadre(selezionato);
                  setPrompt(selezionato.prompt ?? '');
                  setNegativo(selezionato.negative_prompt ?? '');
                  setDidascalia(selezionato.caption ?? '');
                  setAlt(selezionato.alt_text ?? '');
                  setStile(selezionato.style ?? '');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
