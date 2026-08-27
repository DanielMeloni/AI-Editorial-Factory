'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { ProjectVolumeRow } from '@/lib/db/types';
import type { StatoScheda } from '@/lib/projects/progress';

const FASI = [
  { segment: 'sources', label: 'Fonti', numero: 1 },
  { segment: 'structure', label: 'Struttura', numero: 2 },
  { segment: 'structure', label: 'Stesura e audit', numero: 3 },
  { segment: 'reviews', label: 'Revisioni', numero: 4 },
  { segment: 'cover-studio', label: 'Copertina', numero: 5 },
  { segment: 'preview', label: 'Anteprima', numero: 6 },
  { segment: 'blog', label: 'Blog', numero: 7 },
  { segment: 'courses', label: 'Corsi', numero: 7 },
  { segment: 'exports', label: 'Pubblicazioni', numero: 7 },
] as const;
const STRUMENTI = [
  { segment: '', label: 'Panoramica' }, { segment: 'workflows', label: 'Esecuzioni' },
  { segment: 'visual-studio', label: 'Figure' },
  { segment: 'quality', label: 'Qualità' },
] as const;

export function ProjectTabs({ projectId, stati = {}, volumes }: { projectId: string; stati?: Partial<Record<string, StatoScheda>>; volumes: ProjectVolumeRow[] }) {
  const pathname = usePathname(); const router = useRouter(); const params = useSearchParams();
  const selected = params.get('volume') ?? volumes[0]?.id ?? ''; const base = `/projects/${projectId}`;
  const hrefFor = (segment: string) => `${segment ? `${base}/${segment}` : base}${selected ? `?volume=${selected}` : ''}`;
  return <nav aria-label="Flusso del volume" className="space-y-2 py-2">
    <div className="flex min-w-max items-center gap-3">
      {volumes.length ? <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">MANUALE<select value={selected} onChange={(event) => { const query = new URLSearchParams(params.toString()); query.set('volume', event.target.value); router.push(`${pathname}?${query}`); }} className="h-8 max-w-72 rounded-full border border-border-strong bg-surface px-3 text-sm font-medium text-foreground">{volumes.map((v) => <option key={v.id} value={v.id}>Volume {v.volume_number} · {v.subtitle || v.title}</option>)}</select></label> : null}
      <div className="h-5 w-px bg-border-subtle" aria-hidden="true" />
      <ol className="flex items-center gap-1 overflow-x-auto">{FASI.map((fase, index) => {
        const href = hrefFor(fase.segment); const active = pathname.startsWith(`${base}/${fase.segment}`);
        const stato = fase.numero === 7 ? (stati.exports ?? 'bloccata') : (stati[fase.segment] ?? 'bloccata');
        return <li key={`${fase.label}-${index}`}><Link href={href} aria-current={active ? 'step' : undefined} className={cn('flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors', active ? 'border-primary bg-primary/10 text-primary' : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground')}><span className={cn('flex size-5 items-center justify-center rounded-full text-[11px] font-semibold', stato === 'pronto' ? 'bg-success-surface text-success' : stato === 'attesa' ? 'bg-warning-surface text-warning' : 'bg-surface-muted text-muted-foreground')}>{stato === 'pronto' ? <Check className="size-3" /> : fase.numero}</span>{fase.label}{stato === 'attesa' ? <Circle className="size-2 fill-current text-warning" /> : null}</Link></li>;
      })}</ol>
    </div>
    <div className="flex items-center gap-1 overflow-x-auto border-t border-border-subtle pt-2"><span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Strumenti</span>{STRUMENTI.map((item) => { const href = hrefFor(item.segment); const active = item.segment ? pathname.startsWith(`${base}/${item.segment}`) : pathname === base; return <Link key={item.label} href={href} className={cn('whitespace-nowrap rounded-md px-2.5 py-1 text-xs', active ? 'bg-surface-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>{item.label}</Link>; })}</div>
  </nav>;
}
