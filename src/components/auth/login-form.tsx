'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/auth/submit-button';
import { login } from '@/lib/auth/actions';
import { initialActionState } from '@/lib/auth/action-state';

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [state, formAction] = useActionState(login, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="redirectTo" value={redirectTo} />

      {state.status === 'error' && state.message ? (
        <Alert tone="danger" title="Accesso non riuscito">
          {state.message}
        </Alert>
      ) : null}

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

      <Field id="password" label="Password" error={state.fieldErrors?.password} required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-describedby={describedBy}
            invalid={Boolean(state.fieldErrors?.password)}
          />
        )}
      </Field>

      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm text-primary hover:underline">
          Password dimenticata?
        </Link>
      </div>

      <SubmitButton>Accedi</SubmitButton>
    </form>
  );
}
