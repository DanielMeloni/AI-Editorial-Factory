'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, MessageSquarePlus, Pencil, RotateCcw, ThumbsDown, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DiffViewer } from './diff-viewer';
import { SplitDiffViewer } from './split-diff-viewer';
import { computeDiff, summarizeDiff } from '@/lib/review/diff';
import {
  addComment,
  approveAll,
  approveSelection,
  rejectReview,
  requestChanges,
  saveManualEdit,
} from '@/lib/review/actions';
import type { CommentRow } from '@/lib/review/queries';

type Vista = 'affiancato' | 'diff' | 'originale' | 'proposta' | 'modifica';

export function ReviewWorkbench({
  reviewId,
  baseContent,
  proposedContent,
  comments,
  readOnly,
}: {
  reviewId: string;
  baseContent: string;
  proposedContent: string;
  comments: CommentRow[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const diff = useMemo(() => computeDiff(baseContent, proposedContent), [baseContent, proposedContent]);

  // Tutte le modifiche partono selezionate: il caso ordinario è approvare
  // l'intera proposta, e deselezionare è più rapido che selezionare da zero.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(diff.hunks.map((h) => h.id)),
  );
  // Chi approva guarda prima il capitolo intero, e solo dopo il dettaglio
  // della singola modifica: l'affiancato è la vista d'ingresso.
  const [vista, setVista] = useState<Vista>('affiancato');
  const [nota, setNota] = useState('');
  const [bozza, setBozza] = useState(proposedContent);
  const [commento, setCommento] = useState('');

  const tutteSelezionate = selected.size === diff.hunks.length;

  function toggle(hunkId: number) {
    setSelected((precedente) => {
      const successiva = new Set(precedente);
      if (successiva.has(hunkId)) successiva.delete(hunkId);
      else successiva.add(hunkId);
      return successiva;
    });
  }

  function esegui(azione: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const esito = await azione();
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  const VISTE: { key: Vista; label: string }[] = [
    { key: 'affiancato', label: 'Affiancato' },
    { key: 'diff', label: 'In linea' },
    { key: 'originale', label: 'Originale' },
    { key: 'proposta', label: 'Proposta' },
    { key: 'modifica', label: 'Modifica manuale' },
  ];

  return (
    <div className="space-y-4">
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-sm">Confronto fra versioni</CardTitle>
              <CardDescription>
                {summarizeDiff(diff)}
                {!readOnly && diff.hunks.length > 0
                  ? ` ${selected.size} su ${diff.hunks.length} selezionate.`
                  : ''}
              </CardDescription>
            </div>

            {!readOnly && diff.hunks.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected(tutteSelezionate ? new Set() : new Set(diff.hunks.map((h) => h.id)))
                }
              >
                {tutteSelezionate ? 'Deseleziona tutto' : 'Seleziona tutto'}
              </Button>
            ) : null}
          </div>

          <div role="tablist" aria-label="Modalità di visualizzazione" className="mt-2 flex gap-1">
            {VISTE.filter((v) => v.key !== 'modifica' || !readOnly).map((v) => (
              <button
                key={v.key}
                role="tab"
                type="button"
                aria-selected={vista === v.key}
                onClick={() => setVista(v.key)}
                className={
                  vista === v.key
                    ? 'rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary'
                    : 'rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-muted'
                }
              >
                {v.label}
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent>
          {diff.identical ? (
            <Alert tone="info">
              Le due versioni sono identiche: la proposta non introduce alcuna modifica.
            </Alert>
          ) : vista === 'affiancato' ? (
            <SplitDiffViewer
              lines={diff.lines}
              hunks={diff.hunks}
              selected={selected}
              onToggle={toggle}
              readOnly={readOnly}
            />
          ) : vista === 'diff' ? (
            <DiffViewer
              lines={diff.lines}
              hunks={diff.hunks}
              selected={selected}
              onToggle={toggle}
              readOnly={readOnly}
            />
          ) : vista === 'modifica' ? (
            <div className="space-y-2">
              <label htmlFor="bozza" className="text-sm font-medium">
                Testo del capitolo
              </label>
              <textarea
                id="bozza"
                value={bozza}
                onChange={(event) => setBozza(event.target.value)}
                rows={24}
                spellCheck={false}
                className="w-full rounded-lg border border-border-strong bg-surface p-3 font-mono text-xs leading-relaxed"
              />
              <p className="text-xs text-muted-foreground">
                Il salvataggio crea una nuova versione: l’originale e la proposta restano intatti.
              </p>
              <Button
                variant="secondary"
                disabled={pending || bozza === proposedContent}
                onClick={() => esegui(() => saveManualEdit(reviewId, bozza))}
              >
                <Pencil aria-hidden="true" />
                Salva come nuova versione
              </Button>
            </div>
          ) : (
            <pre className="max-h-[32rem] overflow-auto rounded-lg border border-border-subtle bg-surface-muted p-3 text-xs leading-relaxed">
              <code>{vista === 'originale' ? baseContent : proposedContent}</code>
            </pre>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {!readOnly ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Decisione</CardTitle>
            <CardDescription>
              Finché non decidi, il workflow resta sospeso e non consuma risorse.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label htmlFor="nota" className="text-sm font-medium">
                Nota per il registro
              </label>
              <textarea
                id="nota"
                value={nota}
                onChange={(event) => setNota(event.target.value)}
                rows={2}
                placeholder="Facoltativa per l’approvazione, obbligatoria per richiedere modifiche."
                className="mt-1 w-full rounded-lg border border-border-strong bg-surface p-2 text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending || diff.identical}
                onClick={() =>
                  esegui(() =>
                    tutteSelezionate
                      ? approveAll(reviewId, nota || null)
                      : approveSelection(reviewId, [...selected], nota || null),
                  )
                }
              >
                <Check aria-hidden="true" />
                {tutteSelezionate
                  ? 'Approva tutto'
                  : `Approva ${selected.size} modifich${selected.size === 1 ? 'a' : 'e'}`}
              </Button>

              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => esegui(() => requestChanges(reviewId, nota || null))}
              >
                <RotateCcw aria-hidden="true" />
                Richiedi modifiche
              </Button>

              <Button
                variant="danger"
                disabled={pending}
                onClick={() => esegui(() => rejectReview(reviewId, nota || null))}
              >
                <ThumbsDown aria-hidden="true" />
                Rifiuta
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            Commenti
            {comments.length > 0 ? <Badge tone="neutral">{comments.length}</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun commento.</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((c) => (
                <li
                  key={c.id}
                  className="rounded-lg border border-border-subtle bg-surface-muted/50 p-3 text-sm"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{new Date(c.created_at).toLocaleString('it-IT')}</span>
                    {c.anchor?.hunkId !== undefined ? (
                      <Badge tone="info">modifica {c.anchor.hunkId + 1}</Badge>
                    ) : null}
                    {c.is_resolved ? <Badge tone="success">risolto</Badge> : null}
                  </div>
                  <p className="whitespace-pre-wrap text-foreground">{c.body}</p>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <textarea
              value={commento}
              onChange={(event) => setCommento(event.target.value)}
              rows={2}
              aria-label="Nuovo commento"
              placeholder="Aggiungi un commento…"
              className="flex-1 rounded-lg border border-border-strong bg-surface p-2 text-sm"
            />
            <Button
              variant="secondary"
              disabled={pending || commento.trim().length === 0}
              onClick={() =>
                esegui(async () => {
                  const esito = await addComment(reviewId, commento, null);
                  if (esito.ok) setCommento('');
                  return esito;
                })
              }
            >
              <MessageSquarePlus aria-hidden="true" />
              Invia
            </Button>
          </div>
        </CardContent>
      </Card>

      {readOnly ? (
        <Alert tone="info" title="Revisione già decisa">
          <span className="flex items-center gap-1">
            <X className="size-3.5" aria-hidden="true" />
            Le azioni sono disattivate. La cronologia resta consultabile.
          </span>
        </Alert>
      ) : null}
    </div>
  );
}
