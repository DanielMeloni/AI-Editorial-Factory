import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { RunStatus } from '@/lib/workflow/status';

export interface WorkflowRunRow {
  id: string;
  kind: string;
  status: RunStatus;
  current_step: string | null;
  completed_steps: number;
  total_steps: number;
  attempt: number;
  chapter_id: string | null;
  external_run_id: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: { message?: string } | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface AgentRunRow {
  id: string;
  agent_key: string;
  step_name: string | null;
  provider: string;
  model: string;
  status: RunStatus;
  duration_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  confidence: number | null;
  warnings: string[];
  error: { message?: string } | null;
  started_at: string;
  finished_at: string | null;
}

export interface IssueRow {
  id: string;
  kind: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  status: string;
  title: string;
  detail: string | null;
  suggestion: string | null;
  location: { line: number | null; heading: string | null; excerpt: string | null };
}

export async function listWorkflowRuns(projectId: string): Promise<WorkflowRunRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<WorkflowRunRow[]>();

  if (error) throw new Error(`Lettura dei workflow fallita: ${error.message}`);
  return data ?? [];
}

export async function listAgentRuns(workflowRunId: string): Promise<AgentRunRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('agent_runs')
    .select(
      'id, agent_key, step_name, provider, model, status, duration_ms, input_tokens, output_tokens, estimated_cost_usd, confidence, warnings, error, started_at, finished_at',
    )
    .eq('workflow_run_id', workflowRunId)
    .order('started_at', { ascending: true })
    .returns<AgentRunRow[]>();

  if (error) throw new Error(`Lettura delle esecuzioni fallita: ${error.message}`);
  return data ?? [];
}

export async function listChapterIssues(chapterId: string): Promise<IssueRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('verification_issues')
    .select('id, kind, severity, status, title, detail, suggestion, location')
    .eq('chapter_id', chapterId)
    .order('created_at', { ascending: false })
    .returns<IssueRow[]>();

  if (error) throw new Error(`Lettura dei rilievi fallita: ${error.message}`);
  return data ?? [];
}

export interface ChapterDetail {
  id: string;
  project_id: string;
  number: number | null;
  label: string | null;
  title: string;
  kind: string;
  status: string;
  word_count: number;
  code_block_count: number;
  figure_count: number;
  placeholder_count: number;
  link_count: number;
  source_path: string | null;
  current_version_id: string | null;
}

export async function getChapter(chapterId: string): Promise<ChapterDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('chapters')
    .select(
      'id, project_id, number, label, title, kind, status, word_count, code_block_count, figure_count, placeholder_count, link_count, source_path, current_version_id',
    )
    .eq('id', chapterId)
    .maybeSingle<ChapterDetail>();

  if (error) throw new Error(`Lettura del capitolo fallita: ${error.message}`);
  return data;
}

export async function getActiveRunForChapter(chapterId: string): Promise<WorkflowRunRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('chapter_id', chapterId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<WorkflowRunRow>();

  return data;
}

export interface VisualAssetRow {
  id: string;
  kind: string;
  generator: string;
  status: string;
  version: number;
  title: string | null;
  caption: string | null;
  alt_text: string | null;
  mermaid_source: string | null;
}

export async function listChapterAssets(chapterId: string): Promise<VisualAssetRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('visual_assets')
    .select('id, kind, generator, status, version, title, caption, alt_text, mermaid_source')
    .eq('chapter_id', chapterId)
    .order('version', { ascending: false })
    .returns<VisualAssetRow[]>();

  if (error) throw new Error(`Lettura degli asset fallita: ${error.message}`);
  return data ?? [];
}
