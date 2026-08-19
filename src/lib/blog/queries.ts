import 'server-only';

import { createClient } from '@/lib/supabase/server';

export interface BlogArticleRow {
  id: string;
  position: number;
  title: string;
  slug: string | null;
  angle: string;
  target_keyword: string | null;
  secondary_keywords: string[];
  search_intent: string | null;
  status: 'planned' | 'generating' | 'drafted' | 'approved' | 'failed';
  content_md: string | null;
  seo: Record<string, unknown>;
  word_count: number;
  error: string | null;
}

export interface BlogPlanRow {
  id: string;
  requested_count: number;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  summary: string | null;
  created_at: string;
  articles: BlogArticleRow[];
}

/** L'ultimo piano del progetto, con i suoi articoli. */
export async function getLatestBlogPlan(projectId: string): Promise<BlogPlanRow | null> {
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from('blog_plans')
    .select('id, requested_count, status, summary, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<Omit<BlogPlanRow, 'articles'>>();

  if (!plan) return null;

  const { data: articles } = await supabase
    .from('blog_articles')
    .select(
      'id, position, title, slug, angle, target_keyword, secondary_keywords, search_intent, status, content_md, seo, word_count, error',
    )
    .eq('plan_id', plan.id)
    .order('position', { ascending: true })
    .returns<BlogArticleRow[]>();

  return { ...plan, articles: articles ?? [] };
}
