'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, FileText, PenLine, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { createBlogPlan, decideBlogPlan, generateBlogArticle } from '@/lib/blog/actions';
import type { BlogPlanRow } from '@/lib/blog/queries';

/**
 * Blog: piano prima, stesura poi.
 *
 * Il piano si approva perché è lì che si decide di cosa parlerà il blog. Gli
 * articoli si generano uno per volta, con il proprio pulsante: una generazione
 * in blocco terrebbe la pagina ferma per minuti e, al primo errore, non
 * saprebbe dire a che punto era arrivata.
 */

const STATO = {
  planned: { label: 'da scrivere', tone: 'neutral' },
  generating: { label: 'in scrittura', tone: 'info' },
  drafted: { label: 'scritto', tone: 'success' },
  approved: { label: 'approvato', tone: 'success' },
  failed: { label: 'non riuscito', tone: 'danger' },
} as const;

export function BlogPanel({ projectId, plan }: { projectId: string; plan: BlogPlanRow | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quanti, setQuanti] = useState('6');
  const [aperto, setAperto] = useState<string | null>(null);

  function esegui(azione: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const esito = await azione();
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  const approvato = plan?.status === 'approved';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Quanti articoli</CardTitle>
          <CardDescription>
            Un agente legge il manuale e propone altrettanti angoli distinti — non un riassunto per
            capitolo. Approvi il piano, poi paghi la scrittura: dieci articoli sbagliati costano
            dieci volte uno sbagliato.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field id="quanti" label="Numero di articoli" hint="Da 1 a 30">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={30}
                value={quanti}
                onChange={(event) => setQuanti(event.target.value)}
                className="w-28"
              />
            )}
          </Field>
          <Button
            disabled={pending}
            onClick={() =>
              esegui(() => createBlogPlan({ projectId, count: Number(quanti) || 1 }))
            }
          >
            <Sparkles aria-hidden="true" />
            {pending ? 'Lavoro…' : plan ? 'Nuovo piano' : 'Proponi il piano'}
          </Button>
        </CardContent>
      </Card>

      {!plan ? (
        <Alert tone="info" title="Nessun piano">
          Il blog nasce dal manuale approvato: gli articoli attingono ai capitoli che hanno superato
          l’audit, non alle fonti grezze.
        </Alert>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                  Piano editoriale
                  <Badge tone={approvato ? 'success' : plan.status === 'rejected' ? 'danger' : 'warning'}>
                    {approvato ? 'approvato' : plan.status === 'rejected' ? 'rifiutato' : 'da approvare'}
                  </Badge>
                  <Badge tone="neutral">{plan.articles.length} articoli</Badge>
                </CardTitle>
                {plan.summary ? <CardDescription>{plan.summary}</CardDescription> : null}
              </div>

              {plan.status === 'pending_approval' ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={pending} onClick={() => esegui(() => decideBlogPlan(plan.id, 'approved'))}>
                    <Check aria-hidden="true" />
                    Approva il piano
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => esegui(() => decideBlogPlan(plan.id, 'rejected'))}
                  >
                    <X aria-hidden="true" />
                    Rifiuta
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <ul className="divide-y divide-border-subtle">
              {plan.articles.map((articolo) => {
                const stato = STATO[articolo.status];
                return (
                  <li key={articolo.id} className="space-y-2 px-5 py-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs text-muted-foreground">{articolo.position}</span>
                      <span className="font-medium text-foreground">{articolo.title}</span>
                      <Badge tone={stato.tone}>{stato.label}</Badge>
                      {articolo.word_count > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {articolo.word_count.toLocaleString('it-IT')} parole
                        </span>
                      ) : null}
                    </div>

                    <p className="text-sm text-muted-foreground">{articolo.angle}</p>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {articolo.target_keyword ? (
                        <Badge tone="accent">{articolo.target_keyword}</Badge>
                      ) : null}
                      {articolo.secondary_keywords?.slice(0, 4).map((chiave) => (
                        <Badge key={chiave} tone="neutral">
                          {chiave}
                        </Badge>
                      ))}
                      {articolo.search_intent ? (
                        <span className="text-muted-foreground">intento: {articolo.search_intent}</span>
                      ) : null}
                    </div>

                    {articolo.error ? (
                      <p className="text-xs text-danger">{articolo.error}</p>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending || !approvato}
                        onClick={() => esegui(() => generateBlogArticle(articolo.id))}
                      >
                        <PenLine aria-hidden="true" />
                        {articolo.content_md ? 'Riscrivi' : 'Scrivi l’articolo'}
                      </Button>

                      {articolo.content_md ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setAperto(aperto === articolo.id ? null : articolo.id)}
                        >
                          <FileText aria-hidden="true" />
                          {aperto === articolo.id ? 'Chiudi' : 'Leggi'}
                        </Button>
                      ) : null}
                    </div>

                    {aperto === articolo.id && articolo.content_md ? (
                      <div className="space-y-2">
                        <SeoRiquadro seo={articolo.seo} />
                        <pre className="max-h-96 overflow-auto rounded-lg border border-border-subtle bg-surface-muted p-3 text-xs leading-relaxed">
                          <code>{articolo.content_md}</code>
                        </pre>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** I metadati che i motori e i sistemi che rispondono leggono per primi. */
function SeoRiquadro({ seo }: { seo: Record<string, unknown> }) {
  const testo = (chiave: string) => (typeof seo[chiave] === 'string' ? (seo[chiave] as string) : null);
  const elenco = (chiave: string) => (Array.isArray(seo[chiave]) ? (seo[chiave] as string[]) : []);

  const metaTitle = testo('metaTitle');
  const metaDescription = testo('metaDescription');
  const answerSummary = testo('answerSummary');
  const gaps = elenco('gaps');

  if (!metaTitle && !metaDescription && !answerSummary) return null;

  return (
    <dl className="space-y-1.5 rounded-lg border border-border-subtle bg-surface-muted p-3 text-xs">
      {metaTitle ? (
        <div>
          <dt className="font-medium text-foreground">Titolo per i motori ({metaTitle.length}/70)</dt>
          <dd className="text-muted-foreground">{metaTitle}</dd>
        </div>
      ) : null}
      {metaDescription ? (
        <div>
          <dt className="font-medium text-foreground">Descrizione ({metaDescription.length}/160)</dt>
          <dd className="text-muted-foreground">{metaDescription}</dd>
        </div>
      ) : null}
      {answerSummary ? (
        <div>
          <dt className="font-medium text-foreground">Risposta in apertura</dt>
          <dd className="text-muted-foreground">{answerSummary}</dd>
        </div>
      ) : null}
      {gaps.length > 0 ? (
        <div>
          <dt className="font-medium text-warning">Punti non coperti dalle fonti</dt>
          <dd className="text-muted-foreground">{gaps.join(' · ')}</dd>
        </div>
      ) : null}
    </dl>
  );
}
