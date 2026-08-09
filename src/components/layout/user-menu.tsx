import Link from 'next/link';
import { LogOut, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logout } from '@/lib/auth/actions';

export function UserMenu({ email }: { email: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/settings"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      >
        <UserRound className="size-4" aria-hidden="true" />
        <span className="hidden max-w-[18ch] truncate sm:inline">{email ?? 'Profilo'}</span>
      </Link>

      <form action={logout}>
        <Button type="submit" variant="ghost" size="icon" aria-label="Esci dall’applicazione">
          <LogOut aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}
