-- =============================================================================
-- 08 · Output editoriali, esportazioni, consumo AI, audit
-- =============================================================================

-- ---------------------------------------------------------------------------
-- publication_outputs: manuale, lezione, articolo derivati da una versione
-- approvata. Il legame con chapter_version_id garantisce la tracciabilita'.
-- ---------------------------------------------------------------------------
create table public.publication_outputs (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  chapter_id         uuid references public.chapters (id) on delete cascade,
  chapter_version_id uuid references public.chapter_versions (id) on delete set null,
  workflow_run_id    uuid references public.workflow_runs (id) on delete set null,
  kind               output_kind not null,
  title              text not null,
  slug               text,
  meta               jsonb not null default '{}'::jsonb,     -- SEO, obiettivi, prerequisiti
  content            jsonb not null default '{}'::jsonb,     -- corpo strutturato
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint publication_outputs_slug_format check (
    slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  )
);

create trigger publication_outputs_set_updated_at
  before update on public.publication_outputs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- exports: file prodotti, sempre in bucket privato e serviti via URL firmato
-- ---------------------------------------------------------------------------
create table public.exports (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects (id) on delete cascade,
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  chapter_id            uuid references public.chapters (id) on delete cascade,
  publication_output_id uuid references public.publication_outputs (id) on delete cascade,
  format                export_format not null,
  status                export_status not null default 'queued',
  storage_bucket        text not null default 'publication-exports',
  storage_path          text,
  byte_size             bigint,
  checksum              text,
  error                 text,
  requested_by          uuid references auth.users (id) on delete set null,
  requested_at          timestamptz not null default now(),
  completed_at          timestamptz,
  constraint exports_checksum_format check (checksum is null or checksum ~ '^[0-9a-f]{64}$'),
  constraint exports_ready_has_path check (status <> 'ready' or storage_path is not null)
);

-- ---------------------------------------------------------------------------
-- usage_events: consumo AI, per organizzazione e per esecuzione
-- ---------------------------------------------------------------------------
create table public.usage_events (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  project_id         uuid references public.projects (id) on delete set null,
  agent_run_id       uuid references public.agent_runs (id) on delete set null,
  provider           text not null,
  model              text not null,
  kind               text not null default 'text',
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  image_count        integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  occurred_at        timestamptz not null default now(),
  constraint usage_events_non_negative check (
    input_tokens >= 0 and output_tokens >= 0 and image_count >= 0 and estimated_cost_usd >= 0
  )
);

-- ---------------------------------------------------------------------------
-- audit_log: sola scrittura dal punto di vista applicativo
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_id        uuid references auth.users (id) on delete set null,
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  metadata        jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now()
);
