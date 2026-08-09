'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FolderKanban,
  Image as ImageIcon,
  LayoutDashboard,
  ListChecks,
  Settings,
  Workflow,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils/cn';
import { COMING_SOON_LABEL, type NavIconName, type NavItem } from '@/lib/navigation/items';

/**
 * La corrispondenza nome → componente vive qui, nel Client Component.
 * I componenti non possono attraversare il confine RSC come prop.
 */
const ICONS: Record<NavIconName, ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  projects: FolderKanban,
  workflows: Workflow,
  reviews: ListChecks,
  visual: ImageIcon,
  settings: Settings,
};

export function SidebarNav({ items, label }: { items: readonly NavItem[]; label: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="space-y-1">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = ICONS[item.icon];

        if (!item.available) {
          return (
            <span
              key={item.href}
              aria-disabled="true"
              title={COMING_SOON_LABEL}
              className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground/60"
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
              <span className="ml-auto rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium">
                Presto
              </span>
              <span className="sr-only">{COMING_SOON_LABEL}</span>
            </span>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
