'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { publishChapter, type ExportFormat } from '@/lib/publish/actions';
import type { ChapterOption } from '@/lib/publish/queries';

const FORMATI: { key: ExportFormat; label: string; hint: string }[] = [
  { key: 'markdown', label: 'Markdown', hint: 'Formato editoriale principale, con front matter e riferimenti.' },
  { key: 'html', label: 'HTML', hint: 'Documento semantico e sanificato, pronto per il web.' },
  { key: 'pdf', label: 'PDF', hint: 'Impaginato per la lettura, con numerazione delle pagine.' },
  { key: 'json', label: 'JSON', hint: 'Lezione e articolo in forma strutturata.' },
];

export function PublishPanel({ chapters }: { chapters: ChapterOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const esportabili = chapters.filter((c) => c.hasApprovedVersion);
  const [chapterId, setChapterId] = useState(esportabili[0]?.id ?? '');
  const [formati, setFormati] = useState<Set<ExportFormat>>(
    () => new Set<ExportFormat>(['markdown', 'html', 'pdf']),
  );
  const [derivazioni, setDerivazioni] = useState(true);

  const bloccati = chapters.filter((c) => !c.hasApprovedVersion);

  function toggle(formato: ExportFormat) {
    setFormati((precedente) => {
      const successiva = new Set(precedente);
      if (successiva.has(formato)) successiva.delete(formato);
      else successiva.add(formato);
      return successiva;
    });
  }

  function pubblica() {
    startTransition(async () => {
      const esito = await publishChapter({
        chapterId,
        formats: [...formati],
        includeDerivations: derivazioni,
      });
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  const etichetta = (c: ChapterOption) =>
    c.label
      ? c.number === null
        ? `Appendice ${c.label} — ${c.title}`
        : `Capitolo ${c.label} — ${c.title}`
      : c.title;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileDown className="size-4 text-muted-foreground" aria-hidden="true" />
          Esporta un capitolo
        </CardTitle>
        <CardDescription>
          Si esporta solo da una versione approvata: altrimenti il passaggio di revisione non
          avrebbe senso.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {esportabili.length === 0 ? (
          <Alert tone="warning" title="Nessun capitolo esportabile">
            {chapters.length === 0
              ? 'Carica un archivio e ricostruisci la struttura dell’opera.'
              : 'Ogni capitolo ha una proposta in attesa di approvazione. Decidi dalla scheda Revisioni.'}
          </Alert>
        ) : (
          <>
            <div className="space-y-1.5">
              <label htmlFor="capitolo" className="text-sm font-medium">
                Capitolo
              </label>
              <select
                id="capitolo"
                value={chapterId}
                onChange={(event) => setChapterId(event.target.value)}
                className="h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm"
              >
                {esportabili.map((capitolo) => (
                  <option key={capitolo.id} value={capitolo.id}>
                    {etichetta(capitolo)}
                  </option>
                ))}
              </select>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Formati</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {FORMATI.map((formato) => (
                  <label
                    key={formato.key}
                    className="flex items-start gap-2 rounded-lg border border-border-subtle p-2.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={formati.has(formato.key)}
                      onChange={() => toggle(formato.key)}
                      className="mt-0.5 size-4 accent-[var(--primary)]"
                    />
                    <span>
                      <span className="font-medium">{formato.label}</span>
                      <span className="block text-xs text-muted-foreground">{formato.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={derivazioni}
                onChange={(event) => setDerivazioni(event.target.checked)}
                className="mt-0.5 size-4 accent-[var(--primary)]"
              />
              <span>
                <span className="font-medium">Deriva lezione e articolo</span>
                <span className="block text-xs text-muted-foreground">
                  Estrae ciò che il capitolo contiene ed elenca ciò che resta da scrivere, senza
                  inventarlo.
                </span>
              </span>
            </label>

            <Button disabled={pending || formati.size === 0 || !chapterId} onClick={pubblica}>
              <FileDown aria-hidden="true" />
              {pending ? 'Esportazione…' : `Esporta ${formati.size} formati`}
            </Button>
          </>
        )}

        {bloccati.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {bloccati.length} capitol{bloccati.length === 1 ? 'o' : 'i'} non esportabil
            {bloccati.length === 1 ? 'e' : 'i'}: revisione ancora aperta.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
