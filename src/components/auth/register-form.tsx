'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/auth/submit-button';
import { register } from '@/lib/auth/actions';
import { initialActionState } from '@/lib/auth/action-state';

export function RegisterForm() {
  const [state, formAction] = useActionState(register, initialActionState);

  if (state.status === 'success') {
    return (
      <Alert tone="success" title="Controlla la posta">
        {state.message}
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === 'error' && state.message ? (
        <Alert tone="danger" title="Registrazione non riuscita">
          {state.message}
        </Alert>
      ) : null}

      <Field id="fullName" label="Nome e cognome" error={state.fieldErrors?.fullName} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="fullName"
            autoComplete="name"
            required
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.fullName)}
          />
        )}
      </Field>

      <Field id="email" label="Email" error={state.fieldErrors?.email} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.email)}
          />
        )}
      </Field>

      <Field
        id="password"
        label="Password"
        hint="Almeno 10 caratteri, con una maiuscola, una minuscola e una cifra."
        error={state.fieldErrors?.password}
        required
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.password)}
          />
        )}
      </Field>

      <Field
        id="confirmPassword"
        label="Conferma password"
        error={state.fieldErrors?.confirmPassword}
        required
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.confirmPassword)}
          />
        )}
      </Field>

      <SubmitButton>Crea account</SubmitButton>
    </form>
  );
}
