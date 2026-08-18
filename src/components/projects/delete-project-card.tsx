'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { deleteProject } from '@/lib/projects/actions';

/**
 * Eliminazione del progetto.
 *
 * Tutto il resto dell'applicazione conserva: le versioni non si sovrascrivono,
 * gli asset superati restano. Qui no, e per questo la conferma non è un
 * pulsante ma il titolo da riscrivere: chiede di leggere quale progetto si sta
 * eliminando, cosa che un «sei sicuro?» non ottiene.
 *
 * L'elenco di ciò che sparisce sta sopra il campo, non in una nota: è
 * l'informazione che serve prima di decidere, non dopo.
 */
export function DeleteProjectCard({ projectId, title }: { projectId: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [conferma, setConferma] = useState('');
  const [aperto, setAperto] = useState(false);

  const coincide = conferma.trim() === title.trim();

  function elimina() {
    startTransition(async () => {
      const esito = await deleteProject(projectId, conferma);
      if (!esito.ok) {
        toast.error(esito.message);
        return;
      }
      toast.success(esito.message);
      router.push('/projects');
    });
  }

  return (
    <Card className="border-danger/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm text-danger">
          <Trash2 className="size-4" aria-hidden="true" />
          Elimina il progetto
        </CardTitle>
        <CardDescription>
          È l’unica operazione irreversibile: nulla di ciò che segue viene conservato o archiviato.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!aperto ? (
          <Button variant="secondary" onClick={() => setAperto(true)}>
            Elimina il progetto…
          </Button>
        ) : (
          <>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
              <li>capitoli, versioni e cronologia editoriale</li>
              <li>esecuzioni dei workflow, audit e rilievi</li>
              <li>revisioni, decisioni e commenti</li>
              <li>diagrammi, illustrazioni e grafiche di copertina</li>
              <li>archivi caricati, PDF della biblioteca ed esportazioni</li>
            </ul>

            <Field
              id="conferma-eliminazione"
              label="Scrivi il titolo del progetto per confermare"
              hint={title}
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={conferma}
                  autoComplete="off"
                  onChange={(event) => setConferma(event.target.value)}
                  aria-describedby={describedBy}
                />
              )}
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button variant="danger" disabled={!coincide || pending} onClick={elimina}>
                <Trash2 aria-hidden="true" />
                {pending ? 'Eliminazione…' : 'Elimina definitivamente'}
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setAperto(false);
                  setConferma('');
                }}
              >
                Annulla
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
