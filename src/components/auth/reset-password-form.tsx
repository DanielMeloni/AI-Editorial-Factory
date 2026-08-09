'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/auth/submit-button';
import { resetPassword } from '@/lib/auth/actions';
import { initialActionState } from '@/lib/auth/action-state';

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(resetPassword, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === 'error' && state.message ? (
        <Alert tone="danger">{state.message}</Alert>
      ) : null}

      <Field
        id="password"
        label="Nuova password"
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

      <SubmitButton>Aggiorna password</SubmitButton>
    </form>
  );
}
