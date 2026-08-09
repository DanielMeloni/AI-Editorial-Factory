-- =============================================================================
-- 06 · Revisione umana
-- -----------------------------------------------------------------------------
-- Nessun agente puo' pubblicare senza passare di qui.
-- =============================================================================

create table public.review_requests (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  chapter_id          uuid not null references public.chapters (id) on delete cascade,
  workflow_run_id     uuid references public.workflow_runs (id) on delete set null,
  base_version_id     uuid references public.chapter_versions (id) on delete set null,
  proposed_version_id uuid references public.chapter_versions (id) on delete set null,
  status              review_status not null default 'pending',
  title               text not null default 'Revisione proposta',
  summary             text,
  -- Token opaco usato per riprendere il workflow sospeso (hook del Workflow SDK).
  resume_token        text unique,
  requested_by        uuid references auth.users (id) on delete set null,
  requested_at        timestamptz not null default now(),
  decided_by          uuid references auth.users (id) on delete set null,
  decided_at          timestamptz,
  decision_note       text,
  constraint review_requests_decision_coherent check (
    (status = 'pending' and decided_at is null) or (status <> 'pending' and decided_at is not null)
  ),
  constraint review_requests_versions_differ check (
    base_version_id is null or proposed_version_id is null or base_version_id <> proposed_version_id
  )
);

create table public.review_comments (
  id                uuid primary key default gen_random_uuid(),
  review_request_id uuid not null references public.review_requests (id) on delete cascade,
  project_id        uuid not null references public.projects (id) on delete cascade,
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  author_id         uuid references auth.users (id) on delete set null,
  body              text not null,
  anchor            jsonb not null default '{}'::jsonb,  -- sezione o riga a cui si riferisce
  is_resolved       boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint review_comments_body_length check (char_length(body) between 1 and 10000)
);

create trigger review_comments_set_updated_at
  before update on public.review_comments
  for each row execute function public.set_updated_at();
