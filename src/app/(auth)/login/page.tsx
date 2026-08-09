import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';
import { Alert } from '@/components/ui/alert';
import { safeRedirectTarget } from '@/lib/auth/routes';

export const metadata: Metadata = { title: 'Accedi' };

const ERROR_MESSAGES: Record<string, string> = {
  link_non_valido: 'Il link utilizzato non è valido.',
  link_scaduto: 'Il link è scaduto. Richiedine uno nuovo.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = safeRedirectTarget(params.redirectTo);
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] : undefined;

  return (
    <AuthCard
      title="Accedi"
      description="Entra nella tua redazione multi-agente."
      footer={
        <>
          Non hai un account?{' '}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Registrati
          </Link>
        </>
      }
    >
      {errorMessage ? <Alert tone="warning">{errorMessage}</Alert> : null}
      <LoginForm redirectTo={redirectTo} />
    </AuthCard>
  );
}
