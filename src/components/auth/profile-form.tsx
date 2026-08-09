'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/auth/submit-button';
import { updateProfile } from '@/lib/auth/actions';
import { initialActionState } from '@/lib/auth/action-state';

export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
  const [state, formAction] = useActionState(updateProfile, initialActionState);

  return (
    <form action={formAction} className="space-y-4 max-w-md" noValidate>
      {state.status === 'success' && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}
      {state.status === 'error' && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}

      <Field id="fullName" label="Nome e cognome" error={state.fieldErrors?.fullName} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="fullName"
            defaultValue={fullName}
            autoComplete="name"
            required
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.fullName)}
          />
        )}
      </Field>

      <Field id="email" label="Email" hint="Modifica non ancora disponibile.">
        {({ id, describedBy }) => (
          <Input id={id} value={email} readOnly disabled aria-describedby={describedBy} />
        )}
      </Field>

      <SubmitButton block={false}>Salva modifiche</SubmitButton>
    </form>
  );
}
