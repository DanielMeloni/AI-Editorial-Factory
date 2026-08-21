import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type {
  ChapterRow,
  ProjectRow,
  ProjectSourceRow,
  PublicationPartRow,
  ProjectVolumeRow,
} from '@/lib/db/types';

export async function listProjectVolumes(projectId: string): Promise<ProjectVolumeRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_volumes')
    .select('*')
    .eq('project_id', projectId)
    .order('volume_number')
    .returns<ProjectVolumeRow[]>();
  if (error && /project_volumes|schema cache|does not exist/i.test(error.message)) return [];
  if (error) throw new Error(`Lettura dei volumi fallita: ${error.message}`);
  return data ?? [];
}

export async function getProjectVolume(projectId: string, volumeId: string): Promise<ProjectVolumeRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('project_volumes').select('*')
    .eq('project_id', projectId).eq('id', volumeId).maybeSingle<ProjectVolumeRow>();
  if (error) throw new Error(`Lettura del volume fallita: ${error.message}`);
  return data;
}

/**
 * Letture. Ogni query è comunque protetta dalla RLS: anche se un filtro
 * mancasse, il database non restituirebbe righe di altre organizzazioni.
 */

export async function listProjects(): Promise<ProjectRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false })
    .returns<ProjectRow[]>();

  if (error) throw new Error(`Lettura dei progetti fallita: ${error.message}`);
  return data ?? [];
}

export async function getProject(projectId: string): Promise<ProjectRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .maybeSingle<ProjectRow>();

  if (error) throw new Error(`Lettura del progetto fallita: ${error.message}`);
  return data;
}

export async function listSources(projectId: string): Promise<ProjectSourceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_sources')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .returns<ProjectSourceRow[]>();

  if (error) throw new Error(`Lettura delle fonti fallita: ${error.message}`);
  return data ?? [];
}

export interface ProjectStructure {
  parts: (PublicationPartRow & { chapters: ChapterRow[] })[];
  orphanChapters: ChapterRow[];
  totals: { chapters: number; appendices: number; words: number };
}

export async function getProjectStructure(projectId: string): Promise<ProjectStructure> {
  const supabase = await createClient();

  const [partsResult, chaptersResult] = await Promise.all([
    supabase
      .from('publication_parts')
      .select('id, kind, number, title, order_index, source_path')
      .eq('project_id', projectId)
      .order('order_index', { ascending: true })
      .returns<PublicationPartRow[]>(),
    supabase
      .from('chapters')
      .select('*')
      .eq('project_id', projectId)
      .order('order_index', { ascending: true })
      .returns<ChapterRow[]>(),
  ]);

  if (partsResult.error) throw new Error(`Lettura delle parti fallita: ${partsResult.error.message}`);
  if (chaptersResult.error) {
    throw new Error(`Lettura dei capitoli fallita: ${chaptersResult.error.message}`);
  }

  const chapters = chaptersResult.data ?? [];
  const parts = (partsResult.data ?? []).map((part) => ({
    ...part,
    chapters: chapters.filter((chapter) => chapter.part_id === part.id),
  }));

  return {
    parts,
    orphanChapters: chapters.filter((chapter) => chapter.part_id === null),
    totals: {
      chapters: chapters.filter((c) => c.kind === 'part').length,
      appendices: chapters.filter((c) => c.kind === 'appendix').length,
      words: chapters.reduce((sum, c) => sum + c.word_count, 0),
    },
  };
}

export interface ManifestSummary {
  id: string;
  version: number;
  title: string;
  stats: Record<string, number>;
  discrepancies: { kind: string; severity: string; message: string; path: string | null }[];
  created_at: string;
}

export async function getCurrentManifest(projectId: string): Promise<ManifestSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_manifests')
    .select('id, version, title, stats, discrepancies, created_at')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .maybeSingle<ManifestSummary>();

  if (error) throw new Error(`Lettura del manifesto fallita: ${error.message}`);
  return data;
}
