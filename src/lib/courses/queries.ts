import 'server-only';

import { createClient } from '@/lib/supabase/server';

export interface CourseLessonRow {
  id: string;
  position: number;
  title: string;
  intent: string | null;
  objectives: string[];
  status: 'planned' | 'generating' | 'drafted' | 'approved' | 'failed';
  content_md: string | null;
  word_count: number;
  error: string | null;
}

export interface CourseRow {
  id: string;
  title: string;
  source_kind: 'chapters' | 'topic';
  topic: string | null;
  level: 'base' | 'intermediate' | 'advanced';
  format: 'autoapprendimento' | 'aula' | 'video';
  lesson_minutes: number;
  lesson_count: number;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  summary: string | null;
  prerequisites: string[];
  outcomes: string[];
  created_at: string;
  lessons: CourseLessonRow[];
}

export async function listCourses(projectId: string): Promise<CourseRow[]> {
  const supabase = await createClient();

  const { data: corsi } = await supabase
    .from('courses')
    .select(
      'id, title, source_kind, topic, level, format, lesson_minutes, lesson_count, status, summary, prerequisites, outcomes, created_at',
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .returns<Omit<CourseRow, 'lessons'>[]>();

  if (!corsi || corsi.length === 0) return [];

  const { data: lezioni } = await supabase
    .from('course_lessons')
    .select('id, course_id, position, title, intent, objectives, status, content_md, word_count, error')
    .in('course_id', corsi.map((corso) => corso.id))
    .order('position', { ascending: true })
    .returns<(CourseLessonRow & { course_id: string })[]>();

  return corsi.map((corso) => ({
    ...corso,
    lessons: (lezioni ?? []).filter((lezione) => lezione.course_id === corso.id),
  }));
}

/** I capitoli approvati, per scegliere la sorgente del corso. */
export async function listApprovedChapters(
  projectId: string,
): Promise<{ id: string; title: string; number: number | null }[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('chapters')
    .select('id, title, number, status, kind')
    .eq('project_id', projectId)
    .in('status', ['approved', 'published'])
    .neq('kind', 'back_matter')
    .order('order_index', { ascending: true })
    .returns<{ id: string; title: string; number: number | null; status: string; kind: string }[]>();

  return (data ?? []).map((capitolo) => ({
    id: capitolo.id,
    title: capitolo.title,
    number: capitolo.number,
  }));
}
