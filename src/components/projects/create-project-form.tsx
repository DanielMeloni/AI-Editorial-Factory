'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/auth/submit-button';
import { createProject } from '@/lib/projects/actions';
import { initialActionState } from '@/lib/auth/action-state';

export function CreateProjectForm() {
  const [state, formAction] = useActionState(createProject, initialActionState);

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

        <Field id="volume" label="Volume" hint="Ad esempio: Volume 1" error={state.fieldErrors?.volume}>
          {({ id, describedBy }) => <Input id={id} name="volume" aria-describedby={describedBy} />}
        </Field>
      </div>

      <Field
        id="language"
        label="Lingua"
        hint="Codice di due lettere: it, en, es…"
        error={state.fieldErrors?.language}
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="language"
            defaultValue="it"
            maxLength={2}
            className="w-24"
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.language)}
          />
        )}
      </Field>

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
