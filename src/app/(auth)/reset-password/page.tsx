import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth/auth-card';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = { title: 'Nuova password' };

export default function ResetPasswordPage() {
  return (
    <AuthCard
      title="Imposta una nuova password"
      description="Scegli una password robusta: proteggerà tutti i tuoi progetti editoriali."
    >
      <ResetPasswordForm />
    </AuthCard>
  );
}
