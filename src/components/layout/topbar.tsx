import { ThemeToggle } from '@/components/ui/theme-toggle';
import { UserMenu } from './user-menu';
import { Breadcrumb, type Crumb } from './breadcrumb';

export function Topbar({ email, crumbs }: { email: string | null; crumbs: Crumb[] }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border-subtle bg-surface px-4 sm:px-6">
      <Breadcrumb items={crumbs} />
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <UserMenu email={email} />
      </div>
    </header>
  );
}
