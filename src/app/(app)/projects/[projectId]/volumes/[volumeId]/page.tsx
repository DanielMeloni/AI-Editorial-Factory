import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { buttonVariants } from '@/components/ui/button';
import { getProjectVolume } from '@/lib/projects/queries';
import { updateProjectVolume } from '@/lib/projects/actions';

const selectClass = 'flex h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-foreground';
const areaClass = 'flex w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground';

export default async function VolumePage({ params }: { params: Promise<{ projectId: string; volumeId: string }> }) {
  const { projectId, volumeId } = await params;
  const volume = await getProjectVolume(projectId, volumeId);
  if (!volume) notFound();
  return <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
    <PageHeader title={`Volume ${volume.volume_number}`} description="Configurazione editoriale del manuale." />
    <form action={updateProjectVolume} className="max-w-2xl space-y-5">
      <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="volumeId" value={volumeId} />
      <Field id="title" label="Titolo" required>{({ id }) => <Input id={id} name="title" defaultValue={volume.title} required />}</Field>
      <Field id="subtitle" label="Sottotitolo">{({ id }) => <Input id={id} name="subtitle" defaultValue={volume.subtitle ?? ''} />}</Field>
      <div className="grid gap-5 sm:grid-cols-2"><Field id="level" label="Livello">{({ id }) => <select id={id} name="level" defaultValue={volume.level} className={selectClass}><option value="base">Base</option><option value="intermediate">Intermedio</option><option value="advanced">Avanzato</option></select>}</Field><Field id="targetPages" label="Pagine obiettivo">{({ id }) => <Input id={id} name="targetPages" type="number" min={8} max={2000} defaultValue={volume.target_pages ?? ''} />}</Field></div>
      <Field id="audience" label="A chi si rivolge">{({ id }) => <textarea id={id} name="audience" rows={2} className={areaClass} defaultValue={volume.audience ?? ''} />}</Field>
      <Field id="scope" label="Cosa deve coprire">{({ id }) => <textarea id={id} name="scope" rows={3} className={areaClass} defaultValue={volume.scope ?? ''} />}</Field>
      <Field id="outOfScope" label="Cosa resta fuori">{({ id }) => <textarea id={id} name="outOfScope" rows={3} className={areaClass} defaultValue={volume.out_of_scope ?? ''} />}</Field>
      <div className="flex gap-2"><button className={buttonVariants({ variant: 'primary' })}>Salva volume</button><Link href={`/projects/${projectId}`} className={buttonVariants({ variant: 'ghost' })}>Annulla</Link></div>
    </form>
  </main>;
}
