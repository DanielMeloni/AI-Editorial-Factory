'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Link2, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { createClient } from '@/lib/supabase/client';
import { addLinkReference, removeReference, requestPdfTicket } from '@/lib/sources/actions';
import { MAX_PDF_BYTES } from '@/lib/sources/references';
import type { ReferenceSourceRow } from '@/lib/sources/queries';

/**
 * La biblioteca del progetto: link e PDF aggiunti a mano.
 *
 * Il PDF non attraversa il server applicativo — le Vercel Function accettano
 * circa 4,5 MB di corpo — ma va direttamente allo storage privato con un URL
 * firmato; l'indicizzazione avviene poi sul server, dove il testo viene
 * estratto pagina per pagina.
 */

const STATI: Record<
  ReferenceSourceRow['status'],
  { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
> = {
  proposed: { label: 'Proposta', tone: 'info' },
  pending: { label: 'In attesa', tone: 'neutral' },
  indexing: { label: 'Indicizzazione…', tone: 'info' },
  indexed: { label: 'Indicizzata', tone: 'success' },
  failed: { label: 'Non indicizzata', tone: 'warning' },
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function ReferenceLibrary({
  projectId,
  references,
}: {
  projectId: string;
  references: ReferenceSourceRow[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const [modulo, setModulo] = useState<'nessuno' | 'link' | 'pdf'>('nessuno');
  const [titolo, setTitolo] = useState('');
  const [url, setUrl] = useState('');
  const [nota, setNota] = useState('');
  const [autorevole, setAutorevole] = useState(false);
  const [condivisa, setCondivisa] = useState(false);
  const [fase, setFase] = useState<'idle' | 'caricamento' | 'indicizzazione'>('idle');
  const [errore, setErrore] = useState<string | null>(null);

  const occupato = pending || fase !== 'idle';

  function reset() {
    setTitolo('');
    setUrl('');
    setNota('');
    setAutorevole(false);
    setCondivisa(false);
    setErrore(null);
    setModulo('nessuno');
  }

  function aggiungiLink() {
    setErrore(null);
    startTransition(async () => {
      const esito = await addLinkReference({
        projectId,
        url: url.trim(),
        title: titolo.trim(),
        note: nota.trim() || undefined,
        isAuthoritative: autorevole,
        scope: condivisa ? 'organization' : 'project',
      });

      if (!esito.ok) {
        setErrore(esito.message);
        return;
      }
      toast.success(esito.message);
      reset();
      router.refresh();
    });
  }

  async function caricaPdf(file: File) {
    setErrore(null);

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setErrore('Sono ammessi solo file .pdf.');
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setErrore('Il PDF supera il limite di 100 MiB.');
      return;
    }

    const nome = titolo.trim() || file.name.replace(/\.pdf$/i, '');

    try {
      const ticket = await requestPdfTicket({
        projectId,
        filename: file.name,
        byteSize: file.size,
        title: nome,
        note: nota.trim() || undefined,
        isAuthoritative: autorevole,
        scope: condivisa ? 'organization' : 'project',
      });

      if (!ticket.ok) {
        setErrore(ticket.message);
        return;
      }

      setFase('caricamento');
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, file);

      if (uploadError) {
        setErrore(`Caricamento non riuscito: ${uploadError.message}`);
        setFase('idle');
        router.refresh();
        return;
      }

      setFase('indicizzazione');
      const response = await fetch(
        `/api/projects/${projectId}/references/${ticket.referenceId}/index`,
        { method: 'POST' },
      );
      const risultato = (await response.json()) as {
        ok?: boolean;
        chunks?: number;
        pageCount?: number | null;
        warnings?: string[];
        error?: string;
      };

      if (!response.ok || !risultato.ok) {
        setErrore(
          risultato.error ??
            risultato.warnings?.join(' ') ??
            'Indicizzazione non riuscita: il PDF resta caricato ma non ricercabile.',
        );
        setFase('idle');
        router.refresh();
        return;
      }

      toast.success(
        `PDF indicizzato: ${risultato.pageCount ?? '—'} pagine, ${risultato.chunks ?? 0} blocchi ricercabili.`,
      );
      setFase('idle');
      reset();
      router.refresh();
    } catch (caught) {
      setErrore((caught as Error).message || 'Operazione non riuscita.');
      setFase('idle');
    }
  }

  function rimuovi(referenceId: string, titoloFonte: string) {
    startTransition(async () => {
      const esito = await removeReference(referenceId);
      if (esito.ok) toast.success(`«${titoloFonte}» rimossa.`);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* --- Comandi ------------------------------------------------------ */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={modulo === 'link' ? 'primary' : 'secondary'}
          onClick={() => setModulo(modulo === 'link' ? 'nessuno' : 'link')}
          disabled={occupato}
        >
          <Link2 aria-hidden="true" />
          Aggiungi un link
        </Button>
        <Button
          variant={modulo === 'pdf' ? 'primary' : 'secondary'}
          onClick={() => setModulo(modulo === 'pdf' ? 'nessuno' : 'pdf')}
          disabled={occupato}
        >
          <FileText aria-hidden="true" />
          Carica un PDF
        </Button>
      </div>

      {/* --- Modulo ------------------------------------------------------- */}
      {modulo !== 'nessuno' ? (
        <div className="space-y-4 rounded-lg border border-border-subtle bg-surface-muted/40 p-4">
          <Field
            id="fonte-titolo"
            label="Titolo"
            required
            hint="Come comparirà nell’elenco e nelle proposte."
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={titolo}
                maxLength={300}
                disabled={occupato}
                onChange={(event) => setTitolo(event.target.value)}
                placeholder={
                  modulo === 'link' ? 'Specifica ufficiale del formato' : 'Norma UNI 11654:2022'
                }
              />
            )}
          </Field>

          {modulo === 'link' ? (
            <Field
              id="fonte-url"
              label="Indirizzo"
              required
              hint="Il testo della pagina viene letto e indicizzato. Se la pagina non risponde, il collegamento resta comunque registrato."
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type="url"
                  inputMode="url"
                  aria-describedby={describedBy}
                  value={url}
                  disabled={occupato}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://esempio.org/specifica"
                />
              )}
            </Field>
          ) : null}

          <Field id="fonte-nota" label="Nota" hint="Facoltativa: a cosa serve questa fonte.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={nota}
                maxLength={1000}
                disabled={occupato}
                onChange={(event) => setNota(event.target.value)}
              />
            )}
          </Field>

          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-border-strong"
                checked={autorevole}
                disabled={occupato}
                onChange={(event) => setAutorevole(event.target.checked)}
              />
              <span>
                Vale quanto la documentazione ufficiale
                <span className="block text-xs text-muted-foreground">
                  Una specifica o una norma. Senza la spunta la fonte resta proponibile, ma non
                  scavalca la documentazione del produttore a parità di pertinenza.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-border-strong"
                checked={condivisa}
                disabled={occupato}
                onChange={(event) => setCondivisa(event.target.checked)}
              />
              <span>
                Condividi con tutti i progetti
                <span className="block text-xs text-muted-foreground">
                  La fonte vale per l’intera organizzazione, non solo per questo volume.
                </span>
              </span>
            </label>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="sr-only"
            disabled={occupato}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void caricaPdf(file);
              event.target.value = '';
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            {modulo === 'link' ? (
              <Button
                onClick={aggiungiLink}
                disabled={occupato || titolo.trim() === '' || url.trim() === ''}
                aria-busy={occupato}
              >
                {occupato ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
                {pending ? 'Lettura della pagina…' : 'Aggiungi alla biblioteca'}
              </Button>
            ) : (
              <Button
                onClick={() => inputRef.current?.click()}
                disabled={occupato || titolo.trim() === ''}
                aria-busy={occupato}
              >
                {occupato ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                {fase === 'caricamento'
                  ? 'Caricamento…'
                  : fase === 'indicizzazione'
                    ? 'Estrazione del testo…'
                    : 'Scegli il file PDF'}
              </Button>
            )}

            <Button variant="ghost" onClick={reset} disabled={occupato}>
              Annulla
            </Button>
          </div>

          {errore ? <Alert tone="danger">{errore}</Alert> : null}
        </div>
      ) : null}

      {/* --- Elenco ------------------------------------------------------- */}
      {references.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="Biblioteca vuota"
          description="Aggiungi un link o carica un PDF: verrà indicizzato e la ricerca automatica potrà proporlo insieme alla documentazione ufficiale."
        />
      ) : (
        <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {references.map((reference) => {
            const stato = STATI[reference.status];
            const Icona = reference.kind === 'pdf' ? FileText : Link2;

            return (
              <li key={reference.id} className="flex flex-wrap items-start gap-3 p-3">
                <Icona className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium text-foreground">{reference.title}</p>

                  <p className="truncate text-xs text-muted-foreground">
                    {reference.kind === 'link' ? (
                      <a
                        href={reference.url ?? '#'}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        {reference.url}
                      </a>
                    ) : (
                      <>
                        {reference.original_filename} · {formatBytes(reference.byte_size)}
                        {reference.page_count !== null ? ` · ${reference.page_count} pagine` : ''}
                      </>
                    )}
                  </p>

                  {reference.note ? (
                    <p className="text-xs text-muted-foreground">{reference.note}</p>
                  ) : null}

                  {reference.error_message ? (
                    <p className="text-xs text-warning">{reference.error_message}</p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {reference.project_id === null ? (
                    <Badge tone="accent">Organizzazione</Badge>
                  ) : null}
                  {reference.is_authoritative ? <Badge tone="info">Autorevole</Badge> : null}
                  <Badge tone={stato.tone}>
                    {stato.label}
                    {reference.status === 'indexed' ? ` · ${reference.chunk_count} blocchi` : ''}
                  </Badge>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={occupato}
                    aria-label={`Rimuovi «${reference.title}»`}
                    onClick={() => rimuovi(reference.id, reference.title)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
