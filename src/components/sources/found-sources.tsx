'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Check, ExternalLink, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { decideSuggestion } from '@/lib/sources/actions';
import type { GroupedSuggestion } from '@/lib/sources/queries';

/**
 * Le fonti che la ricerca automatica ha trovato.
 *
 * Raggruppate per affermazione, non per fonte: si decide un'affermazione alla
 * volta, vedendo tutte le alternative. E si vede sempre **perché** una fonte è
 * stata proposta — i termini in comune — perché una proposta senza motivo è
 * una proposta che il revisore non può giudicare, solo subire.
 */

const CATEGORIE: Record<string, string> = {
  comportamento: 'Comportamento',
  sintassi: 'Sintassi',
  prestazioni: 'Prestazioni',
  costo: 'Costi',
  limite: 'Limiti',
  altro: 'Altro',
};

export function FoundSources({ suggestions }: { suggestions: GroupedSuggestion[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function decidi(id: string, decisione: 'accepted' | 'rejected') {
    startTransition(async () => {
      const esito = await decideSuggestion(id, decisione);
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  if (suggestions.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="Nessuna fonte trovata"
        description="Avvia la ricerca oppure esegui l’audit di un capitolo: le affermazioni prive di rimando verranno confrontate con la documentazione ufficiale e con la biblioteca."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {suggestions.map((gruppo) => (
        <li
          key={`${gruppo.chapterId}-${gruppo.line}`}
          className="space-y-3 rounded-lg border border-border-subtle p-4"
        >
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                Capitolo {gruppo.chapterNumber ?? '—'} · {gruppo.chapterTitle} · riga {gruppo.line}
              </span>
              <Badge tone="neutral">{CATEGORIE[gruppo.category] ?? gruppo.category}</Badge>
              {gruppo.status === 'accepted' ? <Badge tone="success">Fonte accettata</Badge> : null}
              {gruppo.status === 'rejected' ? <Badge tone="neutral">Scartata</Badge> : null}
            </div>

            <p className="text-sm text-foreground">
              <span aria-hidden="true">«</span>
              {gruppo.excerpt}
              <span aria-hidden="true">»</span>
            </p>
          </div>

          <ul className="space-y-2">
            {gruppo.candidates.map((candidato) => {
              const decisa = candidato.status !== 'proposed';

              return (
                <li
                  key={candidato.id}
                  className="flex flex-wrap items-start gap-3 rounded-md bg-surface-muted/50 p-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                      {candidato.url !== null ? (
                        <a
                          href={candidato.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 underline underline-offset-2"
                        >
                          {candidato.title}
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <BookOpen className="size-3.5" aria-hidden="true" />
                          {candidato.title}
                        </span>
                      )}

                      {candidato.origin === 'biblioteca' ? (
                        <Badge tone="accent">Biblioteca</Badge>
                      ) : (
                        <Badge tone="info">Documentazione ufficiale</Badge>
                      )}
                    </p>

                    <p className="text-xs text-muted-foreground">
                      {candidato.section ?? '—'}
                      {candidato.page !== null ? ` · pagina ${candidato.page}` : ''}
                      {' · pertinenza '}
                      {candidato.score.toFixed(2)}
                    </p>

                    {candidato.matched_terms.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Termini in comune: {candidato.matched_terms.join(', ')}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {decisa ? (
                      <Badge tone={candidato.status === 'accepted' ? 'success' : 'neutral'}>
                        {candidato.status === 'accepted' ? 'Accettata' : 'Scartata'}
                      </Badge>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => decidi(candidato.id, 'accepted')}
                        >
                          <Check aria-hidden="true" />
                          Accetta
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => decidi(candidato.id, 'rejected')}
                        >
                          <X aria-hidden="true" />
                          Scarta
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
