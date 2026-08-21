'use client';

import { useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { updateProjectVolume } from '@/lib/projects/actions';
import type { ProjectVolumeRow } from '@/lib/db/types';
import { cn } from '@/lib/utils/cn';

const selectClass = 'flex h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-foreground';
const areaClass = 'flex w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground';

export function ProjectVolumesAccordion({ projectId, volumes }: { projectId: string; volumes: ProjectVolumeRow[] }) {
  const [openId, setOpenId] = useState<string | null>(volumes[0]?.id ?? null);

  if (volumes.length === 0) return <p className="text-sm text-muted-foreground">Applica la migration dei volumi per attivare la gestione della collana.</p>;

  return <div className="space-y-2">
    {volumes.map((volume) => {
      const open = openId === volume.id;
      const panelId = `volume-panel-${volume.id}`;
      return <section key={volume.id} className="overflow-hidden rounded-lg border border-border-subtle">
        <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted" aria-expanded={open} aria-controls={panelId} onClick={() => setOpenId(open ? null : volume.id)}>
          <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1"><span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Volume {volume.volume_number}</span><span className="block truncate font-medium text-foreground">{volume.title}{volume.subtitle ? ` — ${volume.subtitle}` : ''}</span></span>
          <Badge>{volume.level}</Badge>
          {volume.target_pages ? <Badge tone="neutral">~{volume.target_pages} pagine</Badge> : null}
          <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
        {open ? <div id={panelId} className="border-t border-border-subtle bg-surface-muted/40 p-4">
          <form action={updateProjectVolume} className="space-y-4">
            <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="volumeId" value={volume.id} />
            <div className="grid gap-4 sm:grid-cols-2"><Field id={`title-${volume.id}`} label="Titolo" required>{({ id }) => <Input id={id} name="title" defaultValue={volume.title} required />}</Field><Field id={`subtitle-${volume.id}`} label="Sottotitolo">{({ id }) => <Input id={id} name="subtitle" defaultValue={volume.subtitle ?? ''} />}</Field></div>
            <div className="grid gap-4 sm:grid-cols-2"><Field id={`level-${volume.id}`} label="Livello">{({ id }) => <select id={id} name="level" defaultValue={volume.level} className={selectClass}><option value="base">Base</option><option value="intermediate">Intermedio</option><option value="advanced">Avanzato</option></select>}</Field><Field id={`pages-${volume.id}`} label="Pagine obiettivo">{({ id }) => <Input id={id} name="targetPages" type="number" min={8} max={2000} defaultValue={volume.target_pages ?? ''} />}</Field></div>
            <Field id={`audience-${volume.id}`} label="A chi si rivolge">{({ id }) => <textarea id={id} name="audience" rows={2} className={areaClass} defaultValue={volume.audience ?? ''} />}</Field>
            <Field id={`scope-${volume.id}`} label="Cosa deve coprire">{({ id }) => <textarea id={id} name="scope" rows={3} className={areaClass} defaultValue={volume.scope ?? ''} />}</Field>
            <Field id={`excluded-${volume.id}`} label="Cosa resta fuori">{({ id }) => <textarea id={id} name="outOfScope" rows={3} className={areaClass} defaultValue={volume.out_of_scope ?? ''} />}</Field>
            <Button type="submit">Salva volume {volume.volume_number}</Button>
          </form>
        </div> : null}
      </section>;
    })}
  </div>;
}
