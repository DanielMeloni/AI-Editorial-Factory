import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { RegisterForm } from '@/components/auth/register-form';

export const metadata: Metadata = { title: 'Registrati' };

export default function RegisterPage() {
  return (
    <AuthCard
      title="Crea il tuo account"
      description="Bastano pochi secondi per iniziare il primo progetto editoriale."
      footer={
        <>
          Hai già un account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Accedi
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
