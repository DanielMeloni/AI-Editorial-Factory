-- =============================================================================
-- Hardening editoriale P0 - Documento agentico 1.1
-- Artefatti tipizzati, audience profile, Entity Registry, quality gate,
-- render snapshot e golden sample. Tutte le tabelle sono tenant-scoped.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'editorial_artifact_kind') then
    create type editorial_artifact_kind as enum (
      'manuscript_content', 'qa_metadata', 'evidence', 'internal_notes',
      'visual_spec', 'approved_asset', 'publication_metadata'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'editorial_quality_gate') then
    create type editorial_quality_gate as enum (
      'leakage', 'completeness', 'audience_fit', 'entity_consistency',
      'visual_qa', 'layout_preflight'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'editorial_gate_status') then
    create type editorial_gate_status as enum ('passed', 'failed', 'overridden');
  end if;
  if not exists (select 1 from pg_type where typname = 'editorial_entity_kind') then
    create type editorial_entity_kind as enum (
      'project_display_name', 'project_id', 'repository', 'workspace',
      'dataset', 'service_account', 'other'
    );
  end if;
end $$;

alter table public.projects
  add column if not exists audience_profile jsonb not null default jsonb_build_object(
    'level', 'beginner',
    'goal', 'Comprendere i concetti e completare il primo risultato operativo guidato.',
    'allowedPrerequisites', jsonb_build_array(),
    'jargonBudget', 5,
    'quickWinMaxPages', 25,
    'advancedContentPolicy', 'appendix',
    'requireUiScreenshots', true,
    'requireExpectedStateVisuals', true
  );

alter table public.project_volumes
  add column if not exists audience_profile jsonb;

alter table public.chapter_versions
  add column if not exists artifact_kind editorial_artifact_kind not null default 'manuscript_content';

alter table public.exports
  add column if not exists preflight_status text not null default 'pending'
    check (preflight_status in ('pending', 'passed', 'failed', 'not_applicable'));

alter table public.visual_assets
  add column if not exists visual_role text check (visual_role in ('concept', 'procedure', 'result')),
  add column if not exists capture_source text check (capture_source in ('generated', 'uploaded', 'ui_capture')),
  add column if not exists quality_metadata jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chapter_versions_manuscript_only') then
    alter table public.chapter_versions add constraint chapter_versions_manuscript_only
      check (artifact_kind = 'manuscript_content');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_audience_profile_shape') then
    alter table public.projects add constraint projects_audience_profile_shape check (
      jsonb_typeof(audience_profile) = 'object'
      and audience_profile ?& array[
        'level', 'goal', 'allowedPrerequisites', 'jargonBudget',
        'quickWinMaxPages', 'advancedContentPolicy',
        'requireUiScreenshots', 'requireExpectedStateVisuals'
      ]
    );
  end if;
end $$;

create table if not exists public.editorial_artifacts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  project_id         uuid not null references public.projects (id) on delete cascade,
  chapter_id         uuid references public.chapters (id) on delete cascade,
  workflow_run_id    uuid references public.workflow_runs (id) on delete set null,
  agent_run_id       uuid references public.agent_runs (id) on delete set null,
  kind               editorial_artifact_kind not null,
  payload            jsonb not null default '{}'::jsonb,
  content_text       text,
  content_hash       text,
  approved           boolean not null default false,
  approved_by        uuid references auth.users (id) on delete set null,
  approved_at        timestamptz,
  promoted_from_id   uuid references public.editorial_artifacts (id) on delete restrict,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint editorial_artifacts_approval_complete check (
    (approved = false and approved_at is null)
    or (approved = true and approved_at is not null and approved_by is not null)
  ),
  constraint editorial_artifacts_promotion_explicit check (
    kind <> 'manuscript_content' or promoted_from_id is null or approved = true
  )
);

create table if not exists public.project_entities (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  project_id         uuid not null references public.projects (id) on delete cascade,
  kind               editorial_entity_kind not null,
  canonical_name     text not null,
  aliases            text[] not null default '{}',
  forbidden_aliases  text[] not null default '{}',
  notes              text,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, kind, canonical_name)
);

create table if not exists public.quality_gate_results (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  project_id          uuid not null references public.projects (id) on delete cascade,
  chapter_id          uuid references public.chapters (id) on delete cascade,
  chapter_version_id  uuid references public.chapter_versions (id) on delete cascade,
  workflow_run_id     uuid references public.workflow_runs (id) on delete set null,
  export_id           uuid references public.exports (id) on delete cascade,
  gate                editorial_quality_gate not null,
  status              editorial_gate_status not null,
  blocking_issues     jsonb not null default '[]'::jsonb,
  warnings            jsonb not null default '[]'::jsonb,
  overridden_by       uuid references auth.users (id) on delete set null,
  override_reason     text,
  created_at          timestamptz not null default now(),
  constraint quality_gate_override_reason check (
    status <> 'overridden'
    or (overridden_by is not null and char_length(trim(coalesce(override_reason, ''))) >= 10)
  )
);

create table if not exists public.render_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  project_id         uuid not null references public.projects (id) on delete cascade,
  export_id          uuid references public.exports (id) on delete cascade,
  storage_bucket     text not null default 'publication-exports',
  storage_path       text not null,
  checksum           text not null,
  page_count         integer not null check (page_count > 0),
  rendered_pages     jsonb not null default '[]'::jsonb,
  visual_qa_status   editorial_gate_status not null default 'failed',
  preflight_report   jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  unique (project_id, checksum)
);

create table if not exists public.golden_samples (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  project_id          uuid not null references public.projects (id) on delete cascade,
  series_id           uuid references public.series (id) on delete cascade,
  chapter_id          uuid references public.chapters (id) on delete cascade,
  chapter_version_id  uuid references public.chapter_versions (id) on delete restrict,
  render_snapshot_id  uuid references public.render_snapshots (id) on delete restrict,
  scope               text not null check (scope in ('chapter', 'volume', 'series')),
  approved_by         uuid not null references auth.users (id) on delete restrict,
  approved_at         timestamptz not null default now(),
  is_active           boolean not null default true,
  notes               text
);

create unique index if not exists golden_samples_one_active_scope
  on public.golden_samples (project_id, scope, coalesce(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_active;
create index if not exists editorial_artifacts_project_kind_idx on public.editorial_artifacts (project_id, kind);
create index if not exists editorial_artifacts_organization_idx on public.editorial_artifacts (organization_id);
create index if not exists editorial_artifacts_chapter_idx on public.editorial_artifacts (chapter_id);
create index if not exists editorial_artifacts_workflow_idx on public.editorial_artifacts (workflow_run_id);
create index if not exists editorial_artifacts_agent_run_idx on public.editorial_artifacts (agent_run_id);
create index if not exists editorial_artifacts_promoted_from_idx on public.editorial_artifacts (promoted_from_id);
create index if not exists project_entities_project_idx on public.project_entities (project_id, kind);
create index if not exists project_entities_organization_idx on public.project_entities (organization_id);
create index if not exists quality_gate_results_version_idx on public.quality_gate_results (chapter_version_id, gate, created_at desc);
create index if not exists quality_gate_results_organization_idx on public.quality_gate_results (organization_id);
create index if not exists quality_gate_results_project_idx on public.quality_gate_results (project_id);
create index if not exists quality_gate_results_chapter_idx on public.quality_gate_results (chapter_id);
create index if not exists quality_gate_results_workflow_idx on public.quality_gate_results (workflow_run_id);
create index if not exists quality_gate_results_export_idx on public.quality_gate_results (export_id);
create index if not exists quality_gate_results_overridden_by_idx on public.quality_gate_results (overridden_by);
create index if not exists render_snapshots_project_idx on public.render_snapshots (project_id, created_at desc);
create index if not exists render_snapshots_organization_idx on public.render_snapshots (organization_id);
create index if not exists render_snapshots_export_idx on public.render_snapshots (export_id);
create index if not exists golden_samples_organization_idx on public.golden_samples (organization_id);
create index if not exists golden_samples_series_idx on public.golden_samples (series_id);
create index if not exists golden_samples_chapter_idx on public.golden_samples (chapter_id);
create index if not exists golden_samples_version_idx on public.golden_samples (chapter_version_id);
create index if not exists golden_samples_render_idx on public.golden_samples (render_snapshot_id);

create or replace function public.prevent_artifact_kind_change()
returns trigger language plpgsql as $$
begin
  if new.kind <> old.kind then
    raise exception 'artifact kind is immutable; create a promoted artifact instead';
  end if;
  return new;
end;
$$;

drop trigger if exists editorial_artifacts_kind_immutable on public.editorial_artifacts;
create trigger editorial_artifacts_kind_immutable
  before update of kind on public.editorial_artifacts
  for each row execute function public.prevent_artifact_kind_change();

drop trigger if exists project_entities_set_updated_at on public.project_entities;
create trigger project_entities_set_updated_at
  before update on public.project_entities
  for each row execute function public.set_updated_at();

do $$
declare
  t text;
  tables text[] := array[
    'editorial_artifacts', 'project_entities', 'quality_gate_results',
    'render_snapshots', 'golden_samples'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))',
      t || '_select_member', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_org_member(organization_id))',
      t || '_insert_member', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id))',
      t || '_update_member', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_org_member(organization_id))',
      t || '_delete_member', t
    );
  end loop;
end $$;
