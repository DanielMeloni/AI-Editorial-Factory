import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="text-2xl font-semibold text-foreground">Pagina non trovata</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        L’indirizzo richiesto non esiste o non è più disponibile.
      </p>
      <Link href="/dashboard" className={buttonVariants({ variant: 'primary' })}>
        Torna alla dashboard
      </Link>
    </main>
  );
}
