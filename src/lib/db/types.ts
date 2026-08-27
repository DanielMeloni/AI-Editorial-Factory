/**
 * Tipi delle righe del database, scritti a mano.
 *
 * Quando il progetto Supabase sarà attivo, `npm run db:types` genererà
 * `src/lib/supabase/database.types.ts` a partire dallo schema reale e questi
 * tipi potranno essere sostituiti. Fino ad allora servono a mantenere
 * tipizzate le query senza inventare una connessione.
 */

export type MemberRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type ProjectStatus = 'draft' | 'importing' | 'ready' | 'archived';
export type SourceStatus = 'uploaded' | 'extracting' | 'extracted' | 'partial' | 'failed';
export type PartKind = 'front_matter' | 'part' | 'appendix' | 'back_matter';
export type ChapterStatus = 'draft' | 'in_review' | 'approved' | 'published';
export type VersionOrigin = 'original' | 'ai_proposal' | 'human_edit' | 'approved';
export type EditorialArtifactKind =
  | 'manuscript_content'
  | 'qa_metadata'
  | 'evidence'
  | 'internal_notes'
  | 'visual_spec'
  | 'approved_asset'
  | 'publication_metadata';

export interface AudienceProfile {
  level: 'beginner' | 'intermediate' | 'advanced';
  goal: string;
  allowedPrerequisites: string[];
  jargonBudget: number;
  quickWinMaxPages: number;
  advancedContentPolicy: 'inline' | 'callout' | 'appendix' | 'next_volume';
  requireUiScreenshots: boolean;
  requireExpectedStateVisuals: boolean;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
}

export interface MembershipRow {
  organization_id: string;
  role: MemberRole;
  organizations: OrganizationRow | null;
}

export interface ProjectRow {
  id: string;
  organization_id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  author: string;
  volume: string | null;
  language: string;
  status: ProjectStatus;
  description: string | null;
  level: 'base' | 'intermediate' | 'advanced';
  tone: string;
  register: string;
  style_notes: string | null;
  work_shape: 'volume_singolo' | 'collana' | 'guida_rapida';
  target_pages: number | null;
  scope: string | null;
  out_of_scope: string | null;
  audience: string | null;
  audience_profile: AudienceProfile;
  created_at: string;
  updated_at: string;
}

export interface ProjectSourceRow {
  id: string;
  project_id: string;
  organization_id: string;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  byte_size: number;
  sha256: string | null;
  status: SourceStatus;
  file_count: number;
  ignored_count: number;
  error_count: number;
  errors: { path: string; reason: string; detail?: string }[];
  error_message: string | null;
  created_at: string;
  extracted_at: string | null;
}

export interface ProjectVolumeRow {
  id: string;
  project_id: string;
  organization_id: string;
  volume_number: number;
  title: string;
  subtitle: string | null;
  level: 'base' | 'intermediate' | 'advanced';
  audience: string | null;
  audience_profile: AudienceProfile | null;
  scope: string | null;
  out_of_scope: string | null;
  target_pages: number | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface SourceFileRow {
  id: string;
  normalized_path: string;
  filename: string;
  extension: string;
  kind: string;
  byte_size: number;
  word_count: number;
  is_ignored: boolean;
  ignore_reason: string | null;
}

export interface ChapterRow {
  id: string;
  project_id: string;
  organization_id: string;
  part_id: string | null;
  kind: PartKind;
  number: number | null;
  label: string | null;
  title: string;
  slug: string;
  order_index: number;
  status: ChapterStatus;
  word_count: number;
  code_block_count: number;
  heading_count: number;
  figure_count: number;
  placeholder_count: number;
  link_count: number;
  source_path: string | null;
  current_version_id: string | null;
}

export interface PublicationPartRow {
  id: string;
  kind: PartKind;
  number: number | null;
  title: string;
  order_index: number;
  source_path: string | null;
}

export interface ChapterVersionRow {
  id: string;
  chapter_id: string;
  version_no: number;
  origin: VersionOrigin;
  content_md: string;
  content_hash: string;
  word_count: number;
  is_approved: boolean;
  artifact_kind: 'manuscript_content';
  created_at: string;
}
