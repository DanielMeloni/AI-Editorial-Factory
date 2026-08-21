'use client';

import { useActionState, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/auth/submit-button';
import { createProject } from '@/lib/projects/actions';
import { initialActionState } from '@/lib/auth/action-state';
import { LIVELLI, REGISTRI, TONI, type VoceEditoriale } from '@/lib/editorial/direzione';
import { FORME } from '@/lib/editorial/brief';

const CLASSE_SELECT =
  'flex h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-foreground';

/**
 * Scelta editoriale.
 *
 * Ogni opzione mostra a chi parla quel valore: la differenza fra un volume base
 * e uno avanzato si decide qui, e nasconderla dietro una parola sola
 * costringerebbe a indovinare.
 */
function SceltaEditoriale<T extends string>({
  id,
  name,
  label,
  voci,
  defaultValue,
  error,
}: {
  id: string;
  name: string;
  label: string;
  voci: VoceEditoriale<T>[];
  defaultValue: T;
  error?: string;
}) {
  return (
    <Field
      id={id}
      label={label}
      hint={voci.map((voce) => `${voce.label}: ${voce.hint}`).join(' · ')}
      error={error}
    >
      {({ id: fieldId, describedBy }) => (
        <select id={fieldId} name={name} defaultValue={defaultValue} aria-describedby={describedBy} className={CLASSE_SELECT}>
          {voci.map((voce) => (
            <option key={voce.value} value={voce.value}>
              {voce.label} — {voce.hint}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function CreateProjectForm() {
  const [state, formAction] = useActionState(createProject, initialActionState);
  const [workShape, setWorkShape] = useState('volume_singolo');

  return (
    <form action={formAction} className="max-w-2xl space-y-5" noValidate>
      {state.status === 'error' && state.message ? (
        <Alert tone="danger" title="Creazione non riuscita">
          {state.message}
        </Alert>
      ) : null}

      <Field
        id="title"
        label="Titolo dell’opera"
        hint="Ad esempio: Dataform in Pratica"
        error={state.fieldErrors?.title}
        required
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="title"
            required
            autoFocus
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.title)}
          />
        )}
      </Field>

      <Field id="subtitle" label="Sottotitolo" error={state.fieldErrors?.subtitle}>
        {({ id, describedBy }) => <Input id={id} name="subtitle" aria-describedby={describedBy} />}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="author" label="Autore" error={state.fieldErrors?.author}>
          {({ id, describedBy }) => (
            <Input id={id} name="author" autoComplete="name" aria-describedby={describedBy} />
          )}
        </Field>

        <Field id="language" label="Lingua" hint="Codice di due lettere: it, en, es…" error={state.fieldErrors?.language}>
          {({ id, describedBy }) => <Input id={id} name="language" defaultValue="it" maxLength={2} aria-describedby={describedBy} invalid={Boolean(state.fieldErrors?.language)} />}
        </Field>
      </div>

      <fieldset className="space-y-5 rounded-lg border border-border-subtle p-4">
        <legend className="px-1 text-sm font-medium text-foreground">Configurazioni globali</legend>
        <p className="text-xs text-muted-foreground">Queste impostazioni definiscono la pubblicazione nel suo insieme e si applicano a tutti i manuali.</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="workShape" label="Forma dell’opera" hint={FORME.map((voce) => `${voce.label}: ${voce.hint}`).join(' · ')} error={state.fieldErrors?.workShape}>
            {({ id, describedBy }) => <select id={id} name="workShape" value={workShape} onChange={(event) => setWorkShape(event.target.value)} aria-describedby={describedBy} className={CLASSE_SELECT}>{FORME.map((voce) => <option key={voce.value} value={voce.value}>{voce.label} — {voce.hint}</option>)}</select>}
          </Field>
          {workShape === 'collana' ? <Field id="volumeCount" label="Numero di volumi" hint="Crea le configurazioni iniziali; potrai aggiungerne altri." error={state.fieldErrors?.volumeCount}>
            {({ id, describedBy }) => <Input id={id} name="volumeCount" type="number" min={1} max={20} defaultValue={3} aria-describedby={describedBy} />}
          </Field> : <input type="hidden" name="volumeCount" value="1" />}
        </div>
      </fieldset>

      <fieldset className="space-y-5 rounded-lg border border-border-subtle p-4">
        <legend className="px-1 text-sm font-medium text-foreground">Che opera è</legend>
        <p className="text-xs text-muted-foreground">
          Vincola l’ampiezza dell’indice e la profondità dei capitoli. Senza queste indicazioni il
          Curriculum Agent conosce solo il titolo e le fonti: una guida rapida di cento pagine e il
          primo volume di una collana partono dallo stesso materiale e producono indici opposti.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="targetPages"
            label="Pagine obiettivo"
            hint="Facoltativo. Vuoto significa nessun vincolo di lunghezza."
            error={state.fieldErrors?.targetPages}
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                name="targetPages"
                type="number"
                min={8}
                max={2000}
                placeholder="es. 100"
                className="w-32"
                aria-describedby={describedBy}
              />
            )}
          </Field>
        </div>

        <Field
          id="audience"
          label="A chi si rivolge"
          hint="Es. data engineer che usano già BigQuery"
          error={state.fieldErrors?.audience}
        >
          {({ id, describedBy }) => (
            <Input id={id} name="audience" aria-describedby={describedBy} />
          )}
        </Field>

        <Field
          id="scope"
          label="Cosa deve coprire"
          hint="Es. le regole base di SQL: SELECT, JOIN, aggregazioni, sottoquery"
          error={state.fieldErrors?.scope}
        >
          {({ id, describedBy }) => (
            <textarea
              id={id}
              name="scope"
              rows={2}
              aria-describedby={describedBy}
              className="flex w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          )}
        </Field>

        <Field
          id="outOfScope"
          label="Cosa resta fuori"
          hint="Dire cosa non si tratta è spesso più efficace che elencare cosa si tratta: è ciò che impedisce all’indice di allargarsi."
          error={state.fieldErrors?.outOfScope}
        >
          {({ id, describedBy }) => (
            <textarea
              id={id}
              name="outOfScope"
              rows={2}
              aria-describedby={describedBy}
              className="flex w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="space-y-5 rounded-lg border border-border-subtle p-4">
        <legend className="px-1 text-sm font-medium text-foreground">Direzione editoriale</legend>
        <p className="text-xs text-muted-foreground">
          Vincola l’indice e la scrittura di ogni capitolo. È ciò che distingue un volume base da
          uno avanzato sullo stesso argomento: cambiare il solo titolo produrrebbe lo stesso libro.
        </p>

        <div className="grid gap-5 sm:grid-cols-3">
          <SceltaEditoriale
            id="level"
            name="level"
            label="Livello"
            voci={LIVELLI}
            defaultValue="base"
            error={state.fieldErrors?.level}
          />
          <SceltaEditoriale
            id="tone"
            name="tone"
            label="Tono"
            voci={TONI}
            defaultValue="didattico"
            error={state.fieldErrors?.tone}
          />
          <SceltaEditoriale
            id="register"
            name="register"
            label="Registro"
            voci={REGISTRI}
            defaultValue="tecnico_operativo"
            error={state.fieldErrors?.register}
          />
        </div>

        <Field
          id="styleNotes"
          label="Note di stile"
          hint="Ciò che le liste non coprono. Prevale sulle scelte qui sopra."
          error={state.fieldErrors?.styleNotes}
        >
          {({ id, describedBy }) => (
            <textarea
              id={id}
              name="styleNotes"
              rows={2}
              aria-describedby={describedBy}
              className="flex w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          )}
        </Field>
      </fieldset>

      <Field id="description" label="Descrizione" error={state.fieldErrors?.description}>
        {({ id, describedBy }) => (
          <textarea
            id={id}
            name="description"
            rows={3}
            aria-describedby={describedBy}
            className="flex w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
        )}
      </Field>

      <SubmitButton block={false}>Crea progetto</SubmitButton>
    </form>
  );
}
