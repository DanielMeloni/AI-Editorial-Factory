'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/auth/submit-button';
import { forgotPassword } from '@/lib/auth/actions';
import { initialActionState } from '@/lib/auth/action-state';

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPassword, initialActionState);

  if (state.status === 'success') {
    return <Alert tone="success" title="Richiesta inviata">{state.message}</Alert>;
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
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
      <SubmitButton>Invia istruzioni</SubmitButton>
    </form>
  );
}
