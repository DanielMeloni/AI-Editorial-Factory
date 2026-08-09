-- =============================================================================
-- 05 · Agenti, workflow, esecuzioni, problemi rilevati
-- =============================================================================

-- ---------------------------------------------------------------------------
-- agent_definitions: catalogo dei dodici agenti.
-- `implemented` distingue cio' che funziona davvero da cio' che e' solo previsto.
-- ---------------------------------------------------------------------------
create table public.agent_definitions (
  id            uuid primary key default gen_random_uuid(),
  key           agent_key not null unique,
  name          text not null,
  description   text not null,
  version       integer not null default 1,
  default_model text,
  is_visual     boolean not null default false,
  implemented   boolean not null default false,
  input_schema  jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger agent_definitions_set_updated_at
  before update on public.agent_definitions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- workflow_runs
-- ---------------------------------------------------------------------------
create table public.workflow_runs (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete cascade,
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  chapter_id        uuid references public.chapters (id) on delete cascade,
  kind              text not null,
  status            run_status not null default 'queued',
  external_run_id   text,        -- identificativo restituito dal Workflow SDK
  current_step      text,
  completed_steps   integer not null default 0,
  total_steps       integer not null default 0,
  attempt           integer not null default 1,
  cancel_requested  boolean not null default false,
  input             jsonb not null default '{}'::jsonb,
  output            jsonb,
  error             jsonb,
  warnings          jsonb not null default '[]'::jsonb,
  started_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  updated_at        timestamptz not null default now(),
  constraint workflow_runs_steps_coherent check (completed_steps >= 0 and completed_steps <= greatest(total_steps, completed_steps)),
  constraint workflow_runs_attempt_positive check (attempt > 0)
);

create trigger workflow_runs_set_updated_at
  before update on public.workflow_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- agent_runs: una riga per ogni invocazione di agente.
-- Registra tutto cio' che serve a riprodurre, verificare e contabilizzare
-- l'esecuzione: prompt, modello, hash dell'input, fonti, costo, errore.
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id                 uuid primary key default gen_random_uuid(),
  workflow_run_id    uuid references public.workflow_runs (id) on delete cascade,
  project_id         uuid not null references public.projects (id) on delete cascade,
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  chapter_id         uuid references public.chapters (id) on delete cascade,
  agent_key          agent_key not null,
  agent_version      integer not null default 1,
  prompt_version     text not null default 'v1',
  provider           text not null,
  model              text not null,
  step_name          text,
  input_hash         text not null,
  input              jsonb not null default '{}'::jsonb,
  output             jsonb,
  status             run_status not null default 'queued',
  sources_used       jsonb not null default '[]'::jsonb,
  warnings           jsonb not null default '[]'::jsonb,
  confidence         numeric(4, 3),
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  duration_ms        integer,
  attempt            integer not null default 1,
  error              jsonb,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  constraint agent_runs_input_hash_format check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint agent_runs_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint agent_runs_tokens_non_negative check (input_tokens >= 0 and output_tokens >= 0),
  constraint agent_runs_cost_non_negative check (estimated_cost_usd >= 0)
);

-- Chiusura dei riferimenti lasciati aperti nella migration 04.
alter table public.chapter_versions
  add constraint chapter_versions_workflow_run_fkey
  foreign key (workflow_run_id) references public.workflow_runs (id) on delete set null;

alter table public.chapter_versions
  add constraint chapter_versions_agent_run_fkey
  foreign key (agent_run_id) references public.agent_runs (id) on delete set null;

-- ---------------------------------------------------------------------------
-- verification_issues
-- ---------------------------------------------------------------------------
create table public.verification_issues (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  chapter_id      uuid references public.chapters (id) on delete cascade,
  agent_run_id    uuid references public.agent_runs (id) on delete set null,
  workflow_run_id uuid references public.workflow_runs (id) on delete cascade,
  kind            issue_kind not null,
  severity        issue_severity not null default 'medium',
  status          issue_status not null default 'open',
  title           text not null,
  detail          text,
  suggestion      text,
  location        jsonb not null default '{}'::jsonb,  -- riga, heading, blocco di codice
  evidence        jsonb not null default '[]'::jsonb,  -- citazioni e fonti a supporto
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users (id) on delete set null,
  constraint verification_issues_title_length check (char_length(title) between 1 and 300)
);
