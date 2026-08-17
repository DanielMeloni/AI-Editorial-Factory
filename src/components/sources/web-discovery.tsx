'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, Globe, Loader2, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import {
  acceptProposedReference,
  discoverWebSources,
  removeReference,
} from '@/lib/sources/actions';
import type { ReferenceSourceRow } from '@/lib/sources/queries';

/**
 * Ricerca di fonti sul web e proposte in attesa di decisione.
 *
 * Ogni indirizzo mostrato qui è stato **aperto**: ha risposto, e il titolo è
 * quello letto dalla pagina. Chi non ha risposto non è arrivato fin qui. È il
 * motivo per cui questo elenco si può guardare con fiducia — non perché sia
 * stato giudicato bene, ma perché quel che contiene esiste.
 */

const GENERI: Record<string, string> = {
  documentazione_ufficiale: 'Documentazione ufficiale',
  riferimento_api: 'Riferimento API',
  specifica: 'Specifica',
  guida: 'Guida',
  articolo: 'Articolo',
  altro: 'Altro',
};

const PRIORITA: Record<number, { label: string; tone: 'success' | 'info' | 'neutral' }> = {
  1: { label: 'Irrinunciabile', tone: 'success' },
  2: { label: 'Importante', tone: 'info' },
  3: { label: 'Utile', tone: 'neutral' },
};

export function WebDiscovery({
  projectId,
  proposals,
  searchEnabled,
}: {
  projectId: string;
  proposals: ReferenceSourceRow[];
  searchEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [avvisi, setAvvisi] = useState<string[]>([]);

  function cerca() {
    setAvvisi([]);
    startTransition(async () => {
      const esito = await discoverWebSources(projectId, query.trim() || undefined);
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      setAvvisi(esito.warnings ?? []);
      router.refresh();
    });
  }

  function accetta(id: string, titolo: string) {
    startTransition(async () => {
      const esito = await acceptProposedReference(id);
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
      void titolo;
    });
  }

  function scarta(id: string, titolo: string) {
    startTransition(async () => {
      const esito = await removeReference(id);
      if (esito.ok) toast.success(`«${titolo}» scartata.`);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* --- Comando ------------------------------------------------------ */}
      <div className="space-y-3">
        <Field
          id="ricerca-query"
          label="Che cosa cercare"
          hint="Facoltativo. Se lasci vuoto, la ricerca parte dall’argomento del volume e dai titoli dei capitoli."
        >
          {({ id, describedBy }) => (
            <div className="flex flex-wrap gap-2">
              <Input
                id={id}
                aria-describedby={describedBy}
                value={query}
                maxLength={300}
                disabled={pending}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="specifiche ufficiali sul partizionamento delle tabelle"
                className="max-w-xl flex-1"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !pending) cerca();
                }}
              />
              <Button onClick={cerca} disabled={pending} aria-busy={pending}>
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Globe aria-hidden="true" />
                )}
                {pending ? 'Ricerca e verifica…' : 'Cerca fonti sul web'}
              </Button>
            </div>
          )}
        </Field>

        {!searchEnabled ? (
          <Alert tone="warning" title="Ricerca web non attiva">
            Con <code className="font-mono text-xs">AI_SEARCH_PROVIDER=mock</code> non viene
            eseguita alcuna ricerca, e nulla viene inventato per riempire l’elenco. Imposta{' '}
            <code className="font-mono text-xs">AI_SEARCH_PROVIDER=anthropic</code> con la relativa
            chiave per cercare davvero.
          </Alert>
        ) : null}

        {avvisi.length > 0 ? (
          <Alert tone="info" title="Esito della ricerca">
            <ul className="list-disc space-y-1 pl-4">
              {avvisi.slice(0, 6).map((avviso, index) => (
                <li key={index}>{avviso}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </div>

      {/* --- Proposte ----------------------------------------------------- */}
      {proposals.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="Nessuna fonte proposta"
          description="Avvia la ricerca: gli indirizzi trovati vengono aperti uno per uno, e qui compaiono solo quelli che rispondono davvero."
        />
      ) : (
        <ul className="space-y-2">
          {proposals.map((proposta) => {
            const priorita = proposta.priority ? PRIORITA[proposta.priority] : null;

            return (
              <li
                key={proposta.id}
                className="flex flex-wrap items-start gap-3 rounded-lg border border-border-subtle p-3"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <a
                      href={proposta.url ?? '#'}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
                    >
                      {proposta.title}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>

                    {proposta.is_authoritative ? (
                      <Badge tone="info">Dominio ufficiale</Badge>
                    ) : null}
                    {proposta.web_kind ? (
                      <Badge tone="neutral">{GENERI[proposta.web_kind] ?? proposta.web_kind}</Badge>
                    ) : null}
                    {priorita ? <Badge tone={priorita.tone}>{priorita.label}</Badge> : null}
                  </p>

                  {proposta.rationale ? (
                    <p className="text-sm text-muted-foreground">{proposta.rationale}</p>
                  ) : null}

                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
                    Verificata: {proposta.publisher ?? '—'} ha risposto{' '}
                    {proposta.http_status ?? '—'}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => accetta(proposta.id, proposta.title)}
                  >
                    <Check aria-hidden="true" />
                    Aggiungi
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => scarta(proposta.id, proposta.title)}
                  >
                    <X aria-hidden="true" />
                    Scarta
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
