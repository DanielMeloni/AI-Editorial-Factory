import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { VersionOrigin } from '@/lib/db/types';

export interface ReviewRequestRow {
  id: string;
  project_id: string;
  chapter_id: string;
  workflow_run_id: string | null;
  base_version_id: string | null;
  proposed_version_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  title: string;
  summary: string | null;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
}

export interface VersionRow {
  id: string;
  version_no: number;
  origin: VersionOrigin;
  content_md: string;
  summary: string | null;
  word_count: number;
  is_approved: boolean;
  created_at: string;
}

export interface CommentRow {
  id: string;
  body: string;
  author_id: string | null;
  anchor: { hunkId?: number; line?: number } | null;
  is_resolved: boolean;
  created_at: string;
}

export type ReviewRequestWithChapter = ReviewRequestRow & {
  chapters: { title: string; number: number | null; label: string | null } | null;
};

/**
 * Prima ciò che richiede ancora una decisione, poi lo storico già deciso.
 * Dentro i due gruppi prevale l'ordine editoriale del capitolo, non la data
 * dell'audit: la pagina Revisioni segue così la lettura del volume.
 */
export function orderReviewRequests(reviews: ReviewRequestWithChapter[]): ReviewRequestWithChapter[] {
  const collator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' });
  return [...reviews].sort((a, b) => {
    const stato = Number(a.status !== 'pending') - Number(b.status !== 'pending');
    if (stato !== 0) return stato;

    const numeroA = a.chapters?.number;
    const numeroB = b.chapters?.number;
    if (numeroA !== null && numeroA !== undefined && numeroB !== null && numeroB !== undefined) {
      if (numeroA !== numeroB) return numeroA - numeroB;
    } else if (numeroA !== null && numeroA !== undefined) return -1;
    else if (numeroB !== null && numeroB !== undefined) return 1;

    const label = collator.compare(a.chapters?.label ?? '', b.chapters?.label ?? '');
    if (label !== 0) return label;
    return Date.parse(b.requested_at) - Date.parse(a.requested_at);
  });
}

export async function listReviewRequests(projectId: string): Promise<
  ReviewRequestWithChapter[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('review_requests')
    .select('*, chapters(title, number, label)')
    .eq('project_id', projectId)
    .order('requested_at', { ascending: false })
    .returns<
      (ReviewRequestRow & {
        chapters: { title: string; number: number | null; label: string | null } | null;
      })[]
    >();

  if (error) throw new Error(`Lettura delle revisioni fallita: ${error.message}`);
  return orderReviewRequests(data ?? []);
}

export async function getReviewRequest(reviewId: string): Promise<ReviewRequestRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('review_requests')
    .select('*')
    .eq('id', reviewId)
    .maybeSingle<ReviewRequestRow>();

  if (error) throw new Error(`Lettura della revisione fallita: ${error.message}`);
  return data;
}

export async function getVersion(versionId: string): Promise<VersionRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('chapter_versions')
    .select('id, version_no, origin, content_md, summary, word_count, is_approved, created_at')
    .eq('id', versionId)
    .maybeSingle<VersionRow>();

  if (error) throw new Error(`Lettura della versione fallita: ${error.message}`);
  return data;
}

export async function listVersions(chapterId: string): Promise<VersionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('chapter_versions')
    .select('id, version_no, origin, content_md, summary, word_count, is_approved, created_at')
    .eq('chapter_id', chapterId)
    .order('version_no', { ascending: false })
    .returns<VersionRow[]>();

  if (error) throw new Error(`Lettura delle versioni fallita: ${error.message}`);
  return data ?? [];
}

export async function listComments(reviewRequestId: string): Promise<CommentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('review_comments')
    .select('id, body, author_id, anchor, is_resolved, created_at')
    .eq('review_request_id', reviewRequestId)
    .order('created_at', { ascending: true })
    .returns<CommentRow[]>();

  if (error) throw new Error(`Lettura dei commenti fallita: ${error.message}`);
  return data ?? [];
}

export interface PendingReview {
  id: string;
  project_id: string;
  chapter_title: string;
  requested_at: string;
}

/** Revisioni in attesa di decisione, per la dashboard. */
export async function countPendingReviews(): Promise<PendingReview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('review_requests')
    .select('id, project_id, requested_at, chapters(title)')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(10)
    .returns<{ id: string; project_id: string; requested_at: string; chapters: { title: string } | null }[]>();

  if (error) throw new Error(`Lettura delle revisioni in attesa fallita: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    project_id: row.project_id,
    chapter_title: row.chapters?.title ?? 'Capitolo',
    requested_at: row.requested_at,
  }));
}
