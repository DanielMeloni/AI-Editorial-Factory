'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Download, FileText, GraduationCap, PenLine, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { createCourse, decideCourse, generateCourseLesson } from '@/lib/courses/actions';
import { buildCoursePreviewSvg } from '@/lib/courses/preview';
import type { CourseRow } from '@/lib/courses/queries';

/**
 * Corsi: piano approvabile, poi le lezioni una per volta.
 *
 * Le tre scelte in alto — livello, formato, durata — non sono etichette: entrano
 * nel prompt e cambiano la scaletta prima ancora del testo. Un corso in aula da
 * novanta minuti non è lo stesso corso di uno in autoapprendimento da quindici,
 * nemmeno sullo stesso argomento.
 */

const CLASSE_SELECT =
  'flex h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-foreground';

const LIVELLI = [
  { value: 'base', label: 'Base — per chi parte da zero' },
  { value: 'intermediate', label: 'Intermedio — per chi lo usa già' },
  { value: 'advanced', label: 'Avanzato — per chi progetta e decide' },
];

const FORMATI = [
  { value: 'autoapprendimento', label: 'Autoapprendimento — il lettore è solo' },
  { value: 'aula', label: 'Aula — con docente e note per chi insegna' },
  { value: 'video', label: 'Video — copione con indicazioni di scena' },
];

const DURATE = [
  { value: '15', label: '15 minuti — un concetto per lezione' },
  { value: '45', label: '45 minuti — standard' },
  { value: '90', label: '90 minuti — intensiva' },
];

const STATO = {
  planned: { label: 'da scrivere', tone: 'neutral' },
  generating: { label: 'in scrittura', tone: 'info' },
  drafted: { label: 'scritta', tone: 'success' },
  approved: { label: 'approvata', tone: 'success' },
  failed: { label: 'non riuscita', tone: 'danger' },
} as const;

export function CoursesPanel({
  projectId,
  courses,
  chapters,
  author,
  logoHref,
}: {
  projectId: string;
  courses: CourseRow[];
  chapters: { id: string; title: string; number: number | null }[];
  author: string;
  /** Logo dello strumento, già incorporato: l'anteprima si scarica. */
  logoHref: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [sorgente, setSorgente] = useState<'chapters' | 'topic'>('topic');
  const [argomento, setArgomento] = useState('');
  const [scelti, setScelti] = useState<string[]>([]);
  const [livello, setLivello] = useState('base');
  const [formato, setFormato] = useState('autoapprendimento');
  const [durata, setDurata] = useState('45');
  const [lezioni, setLezioni] = useState('6');
  const [aperta, setAperta] = useState<string | null>(null);

  function esegui(azione: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const esito = await azione();
      if (esito.ok) toast.success(esito.message);
      else toast.error(esito.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Nuovo corso</CardTitle>
          <CardDescription>
            Da capitoli già approvati — materiale verificato dall’audit — oppure da un argomento
            libero, che attinge anche alle fonti del progetto.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {(['topic', 'chapters'] as const).map((valore) => (
              <button
                key={valore}
                type="button"
                aria-pressed={sorgente === valore}
                onClick={() => setSorgente(valore)}
                className={
                  sorgente === valore
                    ? 'rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary'
                    : 'rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-muted'
                }
              >
                {valore === 'topic' ? 'Da un argomento' : 'Da capitoli scelti'}
              </button>
            ))}
          </div>

          {sorgente === 'topic' ? (
            <Field id="argomento" label="Argomento del corso">
              {({ id }) => (
                <Input
                  id={id}
                  value={argomento}
                  placeholder="Es. Gestione delle dipendenze in Dataform"
                  onChange={(event) => setArgomento(event.target.value)}
                />
              )}
            </Field>
          ) : chapters.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessun capitolo approvato: approvane almeno uno, oppure parti da un argomento.
            </p>
          ) : (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-foreground">Capitoli</legend>
              <ul className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border-subtle p-2">
                {chapters.map((capitolo) => (
                  <li key={capitolo.id}>
                    <label className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-muted">
                      <input
                        type="checkbox"
                        checked={scelti.includes(capitolo.id)}
                        onChange={() =>
                          setScelti((precedenti) =>
                            precedenti.includes(capitolo.id)
                              ? precedenti.filter((id) => id !== capitolo.id)
                              : [...precedenti, capitolo.id],
                          )
                        }
                        className="size-4 rounded border-border-strong accent-[var(--primary)]"
                      />
                      <span className="text-muted-foreground">
                        {capitolo.number !== null ? `${capitolo.number}. ` : ''}
                      </span>
                      {capitolo.title}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field id="livello" label="Livello">
              {({ id }) => (
                <select id={id} value={livello} onChange={(e) => setLivello(e.target.value)} className={CLASSE_SELECT}>
                  {LIVELLI.map((voce) => (
                    <option key={voce.value} value={voce.value}>{voce.label}</option>
                  ))}
                </select>
              )}
            </Field>

            <Field id="formato" label="Formato">
              {({ id }) => (
                <select id={id} value={formato} onChange={(e) => setFormato(e.target.value)} className={CLASSE_SELECT}>
                  {FORMATI.map((voce) => (
                    <option key={voce.value} value={voce.value}>{voce.label}</option>
                  ))}
                </select>
              )}
            </Field>

            <Field id="durata" label="Durata di ogni lezione">
              {({ id }) => (
                <select id={id} value={durata} onChange={(e) => setDurata(e.target.value)} className={CLASSE_SELECT}>
                  {DURATE.map((voce) => (
                    <option key={voce.value} value={voce.value}>{voce.label}</option>
                  ))}
                </select>
              )}
            </Field>

            <Field id="lezioni" label="Numero di lezioni" hint="Da 1 a 40">
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={40}
                  value={lezioni}
                  onChange={(event) => setLezioni(event.target.value)}
                />
              )}
            </Field>
          </div>

          <Button
            disabled={pending}
            onClick={() =>
              esegui(() =>
                createCourse({
                  projectId,
                  sourceKind: sorgente,
                  topic: sorgente === 'topic' ? argomento : null,
                  chapterIds: sorgente === 'chapters' ? scelti : [],
                  level: livello as 'base' | 'intermediate' | 'advanced',
                  format: formato as 'autoapprendimento' | 'aula' | 'video',
                  lessonMinutes: Number(durata),
                  lessonCount: Number(lezioni) || 1,
                }),
              )
            }
          >
            <GraduationCap aria-hidden="true" />
            {pending ? 'Lavoro…' : 'Progetta il corso'}
          </Button>
        </CardContent>
      </Card>

      {courses.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="Nessun corso"
          description="Il piano nasce dagli esiti — cosa saprà fare chi ha finito — e da lì ricava le lezioni."
        />
      ) : (
        courses.map((corso) => (
          <Card key={corso.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                    {corso.title || 'Corso senza titolo'}
                    <Badge
                      tone={
                        corso.status === 'approved'
                          ? 'success'
                          : corso.status === 'rejected'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {corso.status === 'approved'
                        ? 'approvato'
                        : corso.status === 'rejected'
                          ? 'rifiutato'
                          : 'da approvare'}
                    </Badge>
                    <Badge tone="neutral">{corso.lessons.length} lezioni</Badge>
                    <Badge tone="neutral">{corso.lesson_minutes} min</Badge>
                    <Badge tone="accent">{corso.format}</Badge>
                  </CardTitle>
                  {corso.summary ? <CardDescription>{corso.summary}</CardDescription> : null}
                </div>

                {corso.status === 'pending_approval' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={pending} onClick={() => esegui(() => decideCourse(corso.id, 'approved'))}>
                      <Check aria-hidden="true" />
                      Approva
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => esegui(() => decideCourse(corso.id, 'rejected'))}
                    >
                      <X aria-hidden="true" />
                      Rifiuta
                    </Button>
                  </div>
                ) : null}
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <CoursePreview corso={corso} author={author} logoHref={logoHref} />

              {corso.outcomes.length > 0 ? (
                <div className="text-sm">
                  <p className="font-medium text-foreground">Alla fine saprai</p>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {corso.outcomes.map((esito) => (
                      <li key={esito}>{esito}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                {corso.lessons.map((lezione) => {
                  const stato = STATO[lezione.status];
                  return (
                    <li key={lezione.id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-xs text-muted-foreground">{lezione.position}</span>
                        <span className="text-sm font-medium text-foreground">{lezione.title}</span>
                        <Badge tone={stato.tone}>{stato.label}</Badge>
                      </div>
                      {lezione.intent ? (
                        <p className="text-xs text-muted-foreground">{lezione.intent}</p>
                      ) : null}
                      {lezione.error ? <p className="text-xs text-warning">{lezione.error}</p> : null}

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending || corso.status !== 'approved'}
                          onClick={() => esegui(() => generateCourseLesson(lezione.id))}
                        >
                          <PenLine aria-hidden="true" />
                          {lezione.content_md ? 'Riscrivi' : 'Scrivi la lezione'}
                        </Button>
                        {lezione.content_md ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAperta(aperta === lezione.id ? null : lezione.id)}
                          >
                            <FileText aria-hidden="true" />
                            {aperta === lezione.id ? 'Chiudi' : 'Leggi'}
                          </Button>
                        ) : null}
                      </div>

                      {aperta === lezione.id && lezione.content_md ? (
                        <pre className="max-h-96 overflow-auto rounded-lg border border-border-subtle bg-surface-muted p-3 text-xs leading-relaxed">
                          <code>{lezione.content_md}</code>
                        </pre>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

/**
 * L'anteprima del corso, nella stessa veste della copertina.
 *
 * Costruita dal codice: titolo e numero di lezioni sono dati, e un'immagine
 * generata li scriverebbe storti. Si scarica come SVG — testo che resta testo,
 * scalabile a qualunque dimensione la piattaforma chieda.
 */
function CoursePreview({
  corso,
  author,
  logoHref,
}: {
  corso: CourseRow;
  author: string;
  logoHref: string | null;
}) {
  const svg = buildCoursePreviewSvg({
    title: corso.title || 'Corso senza titolo',
    level: corso.level,
    format: corso.format,
    lessonCount: corso.lessons.length || corso.lesson_count,
    lessonMinutes: corso.lesson_minutes,
    author,
    logoHref,
  });

  function scarica() {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug(corso.title || 'corso')}-anteprima.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      <div
        className="overflow-hidden rounded-lg border border-border-subtle"
        // Costruita interamente da questo codice a partire da valori validati:
        // i testi passano dalla neutralizzazione XML, nessun contenuto esterno
        // viene interpretato.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <Button size="sm" variant="ghost" onClick={scarica}>
        <Download aria-hidden="true" />
        Scarica l’anteprima
      </Button>
    </div>
  );
}

function slug(valore: string): string {
  return (
    valore
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'corso'
  );
}
