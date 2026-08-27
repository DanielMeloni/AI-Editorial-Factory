'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { createClient } from '@/lib/supabase/server';
import { entityKindSchema } from './types';

const uuid = z.string().uuid();

async function ownedProject(projectId: string, organizationId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from('projects').select('id').eq('id', projectId).eq('organization_id', organizationId).maybeSingle();
  return { supabase, exists: Boolean(data) };
}

function values(value: FormDataEntryValue | null): string[] {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

export async function createProjectEntity(formData: FormData): Promise<void> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const parsed = z.object({
    projectId: uuid,
    kind: entityKindSchema,
    canonicalName: z.string().trim().min(1).max(300),
    notes: z.string().trim().max(2000).optional(),
  }).safeParse({
    projectId: formData.get('projectId'), kind: formData.get('kind'),
    canonicalName: formData.get('canonicalName'), notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) return;
  const { supabase, exists } = await ownedProject(parsed.data.projectId, organization.id);
  if (!exists) return;
  await supabase.from('project_entities').insert({
    organization_id: organization.id, project_id: parsed.data.projectId,
    kind: parsed.data.kind, canonical_name: parsed.data.canonicalName,
    aliases: values(formData.get('aliases')), forbidden_aliases: values(formData.get('forbiddenAliases')),
    notes: parsed.data.notes ?? null, created_by: user.id,
  });
  revalidatePath(`/projects/${parsed.data.projectId}/quality`);
}

export async function deleteProjectEntity(formData: FormData): Promise<void> {
  await requireUser();
  const organization = await requireOrganization();
  const parsed = z.object({ projectId: uuid, entityId: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { supabase, exists } = await ownedProject(parsed.data.projectId, organization.id);
  if (!exists) return;
  await supabase.from('project_entities').delete().eq('id', parsed.data.entityId).eq('project_id', parsed.data.projectId);
  revalidatePath(`/projects/${parsed.data.projectId}/quality`);
}

export async function overrideQualityGate(formData: FormData): Promise<void> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const parsed = z.object({ projectId: uuid, gateResultId: uuid, reason: z.string().trim().min(10).max(2000) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { supabase, exists } = await ownedProject(parsed.data.projectId, organization.id);
  if (!exists) return;
  await supabase.from('quality_gate_results').update({
    status: 'overridden', overridden_by: user.id, override_reason: parsed.data.reason,
  }).eq('id', parsed.data.gateResultId).eq('project_id', parsed.data.projectId).eq('status', 'failed');
  revalidatePath(`/projects/${parsed.data.projectId}/quality`);
}

export async function promoteGoldenSample(formData: FormData): Promise<void> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const parsed = z.object({ projectId: uuid, snapshotId: uuid, notes: z.string().trim().max(2000).optional() }).safeParse({
    projectId: formData.get('projectId'), snapshotId: formData.get('snapshotId'), notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) return;
  const { supabase, exists } = await ownedProject(parsed.data.projectId, organization.id);
  if (!exists) return;
  const { data: snapshot } = await supabase.from('render_snapshots')
    .select('id, export_id, visual_qa_status, exports(chapter_id)')
    .eq('id', parsed.data.snapshotId).eq('project_id', parsed.data.projectId)
    .maybeSingle<{ id: string; export_id: string | null; visual_qa_status: string; exports: { chapter_id: string | null } | null }>();
  const chapterId = snapshot?.exports?.chapter_id;
  if (!snapshot || snapshot.visual_qa_status !== 'passed' || !chapterId) return;
  const { data: chapter } = await supabase.from('chapters').select('current_version_id, status').eq('id', chapterId).maybeSingle<{ current_version_id: string | null; status: string }>();
  if (!chapter?.current_version_id || !['approved', 'published'].includes(chapter.status)) return;
  await supabase.from('golden_samples').update({ is_active: false }).eq('project_id', parsed.data.projectId).eq('scope', 'chapter').eq('chapter_id', chapterId).eq('is_active', true);
  await supabase.from('golden_samples').insert({
    organization_id: organization.id, project_id: parsed.data.projectId, chapter_id: chapterId,
    chapter_version_id: chapter.current_version_id, render_snapshot_id: snapshot.id,
    scope: 'chapter', approved_by: user.id, notes: parsed.data.notes ?? null,
  });
  revalidatePath(`/projects/${parsed.data.projectId}/quality`);
}
