import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { getProject } from '@/lib/projects/queries';
import { createClient } from '@/lib/supabase/server';
import { createProjectEntity, deleteProjectEntity, overrideQualityGate, promoteGoldenSample } from '@/lib/editorial-quality/actions';

const field = 'h-9 rounded-md border border-border-strong bg-surface px-3 text-sm';

export default async function QualityPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();
  const supabase = await createClient();
  const [{ data: entities }, { data: gates }, { data: snapshots }, { data: goldens }] = await Promise.all([
    supabase.from('project_entities').select('*').eq('project_id', projectId).order('kind'),
    supabase.from('quality_gate_results').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(50),
    supabase.from('render_snapshots').select('id, export_id, page_count, checksum, rendered_pages, preflight_report, created_at, exports(chapter_id, chapters(title))').eq('project_id', projectId).order('created_at', { ascending: false }).limit(20),
    supabase.from('golden_samples').select('id, chapter_id, render_snapshot_id, notes, approved_at, chapters(title)').eq('project_id', projectId).eq('is_active', true),
  ]);
  const goldenByChapter = new Map((goldens ?? []).map((item) => [item.chapter_id, item]));

  return <main id="contenuto-principale" className="flex-1 space-y-6 p-4 sm:p-6">
    <PageHeader title="Qualità editoriale" description="Registro canonico, gate motivati, snapshot del PDF e campioni d’oro del progetto." />
    <div className="grid gap-6 xl:grid-cols-2">
      <Card><CardHeader><CardTitle>Entity Registry</CardTitle><CardDescription>I nomi qui registrati sono la fonte canonica per manoscritto, schermate e metadati.</CardDescription></CardHeader><CardContent className="space-y-4">
        <form action={createProjectEntity} className="grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="projectId" value={projectId} />
          <select name="kind" className={field} defaultValue="project_display_name"><option value="project_display_name">Nome progetto</option><option value="project_id">ID progetto</option><option value="repository">Repository</option><option value="workspace">Workspace</option><option value="dataset">Dataset</option><option value="service_account">Service account</option><option value="other">Altro</option></select>
          <input name="canonicalName" required placeholder="Nome canonico" className={field} />
          <input name="aliases" placeholder="Alias, separati da virgola" className={field} />
          <input name="forbiddenAliases" placeholder="Alias vietati, separati da virgola" className={field} />
          <input name="notes" placeholder="Note" className={`${field} sm:col-span-2`} />
          <button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground sm:col-span-2">Aggiungi entità</button>
        </form>
        <ul className="divide-y divide-border-subtle">{(entities ?? []).map((entity) => <li key={entity.id} className="flex items-start gap-3 py-3"><div className="min-w-0 flex-1"><div className="flex gap-2"><Badge tone="neutral">{entity.kind}</Badge><strong className="truncate text-sm">{entity.canonical_name}</strong></div><p className="mt-1 text-xs text-muted-foreground">Alias: {(entity.aliases as string[]).join(', ') || '—'} · vietati: {(entity.forbidden_aliases as string[]).join(', ') || '—'}</p></div><form action={deleteProjectEntity}><input type="hidden" name="projectId" value={projectId}/><input type="hidden" name="entityId" value={entity.id}/><button className="text-xs text-danger">Rimuovi</button></form></li>)}</ul>
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Quality gate</CardTitle><CardDescription>Gli override sono espliciti, tracciati e richiedono una motivazione.</CardDescription></CardHeader><CardContent><ul className="space-y-3">{(gates ?? []).map((gate) => <li key={gate.id} className="rounded-md border border-border-subtle p-3"><div className="flex items-center gap-2"><Badge tone={gate.status === 'passed' ? 'success' : gate.status === 'overridden' ? 'warning' : 'danger'}>{gate.status}</Badge><span className="text-sm font-medium">{gate.gate}</span></div>{gate.status === 'failed' ? <form action={overrideQualityGate} className="mt-2 flex gap-2"><input type="hidden" name="projectId" value={projectId}/><input type="hidden" name="gateResultId" value={gate.id}/><input name="reason" required minLength={10} placeholder="Motivazione dell’override (min. 10 caratteri)" className={`${field} min-w-0 flex-1`}/><button className="rounded-md border border-border-strong px-3 text-xs">Override</button></form> : gate.override_reason ? <p className="mt-2 text-xs text-muted-foreground">{gate.override_reason}</p> : null}</li>)}</ul></CardContent></Card>

      <Card className="xl:col-span-2"><CardHeader><CardTitle>Snapshot PDF e golden sample</CardTitle><CardDescription>Promuovi soltanto un PDF approvato e con preflight superato; le impronte pagina permettono il confronto nelle build successive.</CardDescription></CardHeader><CardContent><ul className="divide-y divide-border-subtle">{(snapshots ?? []).map((snapshot) => {
        const relation = snapshot.exports as unknown as { chapter_id: string | null; chapters: { title: string } | null } | null;
        const golden = relation?.chapter_id ? goldenByChapter.get(relation.chapter_id) : undefined;
        const report = snapshot.preflight_report as { changedPages?: number[] };
        return <li key={snapshot.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{relation?.chapters?.title ?? 'Capitolo'} · {snapshot.page_count} pagine</p><p className="text-xs text-muted-foreground">SHA {snapshot.checksum.slice(0, 12)} · pagine cambiate: {report.changedPages?.join(', ') || 'nessuna rilevata'}</p></div>{golden?.render_snapshot_id === snapshot.id ? <Badge tone="success">golden attivo</Badge> : <form action={promoteGoldenSample} className="flex gap-2"><input type="hidden" name="projectId" value={projectId}/><input type="hidden" name="snapshotId" value={snapshot.id}/><input name="notes" placeholder="Nota facoltativa" className={field}/><button className="rounded-md border border-border-strong px-3 text-xs">Promuovi a golden</button></form>}</li>;
      })}</ul></CardContent></Card>
    </div>
  </main>;
}
