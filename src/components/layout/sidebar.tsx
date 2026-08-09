import Link from 'next/link';
import { Logo } from './logo';
import { SidebarNav } from './sidebar-nav';
import { PRIMARY_NAV, SECONDARY_NAV } from '@/lib/navigation/items';

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border-subtle bg-surface lg:flex">
      <div className="flex h-16 items-center border-b border-border-subtle px-4">
        <Link href="/dashboard" aria-label="AI Editorial Factory, vai alla dashboard">
          <Logo />
        </Link>
      </div>

      <div className="flex flex-1 flex-col justify-between overflow-y-auto p-3">
        <SidebarNav items={PRIMARY_NAV} label="Navigazione principale" />
        <SidebarNav items={SECONDARY_NAV} label="Navigazione secondaria" />
      </div>
    </aside>
  );
}
