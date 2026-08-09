import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata: Metadata = { title: 'Recupera password' };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Recupera la password"
      description="Inserisci la tua email: ti invieremo un link per impostarne una nuova."
      footer={
        <Link href="/login" className="font-medium text-primary hover:underline">
          Torna all’accesso
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
