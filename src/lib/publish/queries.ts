import 'server-only';

import { createClient } from '@/lib/supabase/server';

export interface ExportRow {
  id: string;
  chapter_id: string | null;
  format: 'markdown' | 'html' | 'pdf' | 'json';
  status: 'queued' | 'running' | 'ready' | 'failed';
  storage_path: string | null;
  byte_size: number | null;
  checksum: string | null;
  error: string | null;
  requested_at: string;
  completed_at: string | null;
  chapters: { title: string; number: number | null; label: string | null } | null;
}

export interface OutputRow {
  id: string;
  chapter_id: string | null;
  kind: 'manual' | 'lesson' | 'article';
  title: string;
  slug: string | null;
  meta: Record<string, unknown>;
  content: Record<string, unknown>;
  created_at: string;
}

export async function listExports(projectId: string): Promise<ExportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('exports')
    .select('*, chapters(title, number, label)')
    .eq('project_id', projectId)
    .order('requested_at', { ascending: false })
    .limit(100)
    .returns<ExportRow[]>();

  if (error) throw new Error(`Lettura delle esportazioni fallita: ${error.message}`);
  return data ?? [];
}

export async function listOutputs(projectId: string): Promise<OutputRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('publication_outputs')
    .select('id, chapter_id, kind, title, slug, meta, content, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<OutputRow[]>();

  if (error) throw new Error(`Lettura delle pubblicazioni fallita: ${error.message}`);
  return data ?? [];
}

export interface ChapterOption {
  id: string;
  title: string;
  number: number | null;
  label: string | null;
  status: string;
  hasApprovedVersion: boolean;
}

/** Capitoli esportabili: hanno una versione corrente non in attesa di approvazione. */
export async function listExportableChapters(projectId: string): Promise<ChapterOption[]> {
  const supabase = await createClient();

  const { data: chapters } = await supabase
    .from('chapters')
    .select('id, title, number, label, status, current_version_id')
    .eq('project_id', projectId)
    .order('order_index', { ascending: true })
    .returns<{
      id: string; title: string; number: number | null; label: string | null;
      status: string; current_version_id: string | null;
    }[]>();

  if (!chapters || chapters.length === 0) return [];

  const versionIds = chapters
    .map((c) => c.current_version_id)
    .filter((id): id is string => id !== null);

  const { data: versions } = await supabase
    .from('chapter_versions')
    .select('id, origin, is_approved')
    .in('id', versionIds.length > 0 ? versionIds : ['00000000-0000-0000-0000-000000000000'])
    .returns<{ id: string; origin: string; is_approved: boolean }[]>();

  const perId = new Map((versions ?? []).map((v) => [v.id, v]));

  return chapters.map((chapter) => {
    const version = chapter.current_version_id ? perId.get(chapter.current_version_id) : undefined;
    return {
      id: chapter.id,
      title: chapter.title,
      number: chapter.number,
      label: chapter.label,
      status: chapter.status,
      hasApprovedVersion:
        version !== undefined && !(version.origin === 'ai_proposal' && !version.is_approved),
    };
  });
}

/** Stato dell'anteprima del volume, senza esporne l'indirizzo firmato. */
export interface VolumePreviewInfo {
  byteSize: number | null;
  completedAt: string | null;
}

export async function getVolumePreviewInfo(
  projectId: string,
): Promise<VolumePreviewInfo | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('exports')
    .select('byte_size, completed_at, status')
    .eq('project_id', projectId)
    .is('chapter_id', null)
    .eq('format', 'pdf')
    .limit(1)
    .maybeSingle<{ byte_size: number | null; completed_at: string | null; status: string }>();

  if (!data || data.status !== 'ready') return null;
  return { byteSize: data.byte_size, completedAt: data.completed_at };
}
