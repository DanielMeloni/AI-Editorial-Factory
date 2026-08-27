-- =============================================================================
-- AI Editorial Factory · Schema completo
-- -----------------------------------------------------------------------------
-- ATTENZIONE — questo file è un'ALTERNATIVA a `npx supabase db push`, non un
-- complemento. Applicalo in UNO dei due modi, mai in entrambi:
--
--   A) CLI (consigliato, mantiene lo storico delle migration):
--        npx supabase link --project-ref <project-ref>
--        npx supabase db push
--
--   B) SQL Editor del dashboard Supabase:
--        incolla QUESTO file e premi Run, rispettando l'INTERRUZIONE
--        OBBLIGATORIA segnalata più avanti nel file.
--
-- Il contenuto è la concatenazione, nell'ordine, di tutte le migration in
-- supabase/migrations/, comprese le fondamenta delle collane (Fase 8). Non modificarlo a mano: rigeneralo con
--        npm run db:bundle
--
-- Idempotenza: NON è idempotente. Eseguirlo due volte sullo stesso progetto
-- fallisce sul primo CREATE TYPE già esistente. Per ripartire da zero usa
-- `npx supabase db reset` in locale, oppure un progetto Supabase nuovo.
--
-- Prerequisiti: un progetto Supabase con gli schemi `auth` e `storage`
-- (presenti per impostazione predefinita) e Postgres 15 o successivo.
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809120001_enums.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 01 · Tipi enumerati
-- -----------------------------------------------------------------------------
-- Un vocabolario unico condiviso da database, dominio TypeScript e interfaccia.
-- I valori di run_status corrispondono a src/lib/workflow/status.ts.
-- =============================================================================

-- gen_random_uuid() e' nativo da PostgreSQL 13: nessuna estensione necessaria.

create type member_role as enum ('owner', 'admin', 'editor', 'viewer');

create type project_status as enum ('draft', 'importing', 'ready', 'archived');

create type source_status as enum (
  'uploaded',    -- archivio caricato, non ancora elaborato
  'extracting',  -- estrazione in corso
  'extracted',   -- estrazione completata senza errori
  'partial',     -- estratto con errori su singoli file
  'failed'       -- estrazione fallita
);

create type source_file_kind as enum (
  'markdown', 'pdf', 'image', 'code', 'data', 'config', 'script', 'archive', 'other'
);

create type part_kind as enum ('front_matter', 'part', 'appendix', 'back_matter');

create type chapter_status as enum ('draft', 'in_review', 'approved', 'published');

-- Origine di una versione di capitolo. 'original' e' immutabile per definizione.
create type version_origin as enum ('original', 'ai_proposal', 'human_edit', 'approved');

create type run_status as enum (
  'queued', 'running', 'awaiting_approval',
  'completed', 'completed_with_warnings', 'failed', 'cancelled'
);

create type agent_key as enum (
  'ingestion', 'source_auditor', 'curriculum', 'technical_verifier',
  'technical_writer', 'teaching', 'visual_art_director', 'technical_diagram',
  'illustration', 'cover', 'editorial_reviewer', 'publishing'
);

create type issue_kind as enum (
  'technical', 'editorial', 'source', 'curriculum', 'visual', 'structural'
);

create type issue_severity as enum ('info', 'low', 'medium', 'high', 'critical');

create type issue_status as enum ('open', 'acknowledged', 'resolved', 'dismissed');

create type review_status as enum ('pending', 'approved', 'rejected', 'changes_requested');

create type asset_kind as enum (
  'diagram', 'illustration', 'cover_front', 'cover_back', 'cover_spine', 'photo', 'other'
);

-- I diagrammi tecnici sono deterministici; solo 'ai' passa da un modello visuale.
create type asset_generator as enum ('mermaid', 'svg', 'ai', 'upload');

create type asset_status as enum ('draft', 'pending_approval', 'approved', 'rejected', 'superseded');

create type output_kind as enum ('manual', 'lesson', 'article');

create type export_format as enum ('markdown', 'html', 'pdf', 'json');

create type export_status as enum ('queued', 'running', 'ready', 'failed');

-- Formula per il calcolo del dorso: dipende dal fornitore di stampa.
create type spine_formula as enum ('mm_per_page', 'pages_per_inch', 'fixed');

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809120002_identity.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 02 · Identita': profili, organizzazioni, appartenenze
-- -----------------------------------------------------------------------------
-- Ogni dato editoriale appartiene a un'organizzazione, anche quando esiste un
-- solo proprietario. E' la chiave di isolamento su cui poggia tutta la RLS.
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_full_name_length check (char_length(full_name) <= 120)
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  is_personal boolean not null default false,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint organizations_name_length check (char_length(name) between 1 and 120),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------
create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            member_role not null default 'editor',
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Funzioni di appartenenza
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER e' indispensabile: una policy su organization_members che
-- interroghi organization_members entrerebbe in ricorsione infinita.
-- search_path fissato per impedire il dirottamento dei nomi.
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(target_org uuid, allowed member_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.role = any (allowed)
  );
$$;

revoke execute on function public.is_org_member(uuid) from public;
revoke execute on function public.has_org_role(uuid, member_role[]) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, member_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Provisioning automatico alla registrazione
-- -----------------------------------------------------------------------------
-- Crea profilo, organizzazione personale e appartenenza come proprietario.
-- Senza questo trigger un utente appena registrato non apparterrebbe ad alcuna
-- organizzazione e non potrebbe creare progetti.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  display_name text;
  base_slug    text;
  final_slug   text;
  suffix       integer := 0;
  new_org_id   uuid;
begin
  display_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));

  insert into public.profiles (id, full_name)
  values (new.id, left(display_name, 120))
  on conflict (id) do nothing;

  base_slug := regexp_replace(lower(display_name), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then
    base_slug := 'redazione';
  end if;
  base_slug := left(base_slug, 40);

  final_slug := base_slug;
  while exists (select 1 from public.organizations o where o.slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix::text;
  end loop;

  insert into public.organizations (name, slug, is_personal, created_by)
  values (left(display_name, 120), final_slug, true, new.id)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809120003_projects_sources.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 03 · Progetti editoriali e archivi sorgente
-- =============================================================================

create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  slug            text not null,
  title           text not null,
  subtitle        text,
  author          text not null default '',
  volume          text,
  language        text not null default 'it',
  status          project_status not null default 'draft',
  description     text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug),
  constraint projects_title_length check (char_length(title) between 1 and 200),
  constraint projects_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint projects_language_format check (language ~ '^[a-z]{2}$')
);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- project_sources: un archivio caricato (oggi ZIP)
-- -----------------------------------------------------------------------------
-- organization_id e' denormalizzato di proposito: consente alla policy RLS di
-- decidere senza join, e rende impossibile spostare una riga fra organizzazioni
-- senza violare il vincolo di coerenza con il progetto.
-- ---------------------------------------------------------------------------
create table public.project_sources (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  storage_bucket     text not null default 'project-sources',
  storage_path       text not null,
  original_filename  text not null,
  mime_type          text,
  byte_size          bigint not null,
  sha256             text,
  status             source_status not null default 'uploaded',
  file_count         integer not null default 0,
  ignored_count      integer not null default 0,
  error_count        integer not null default 0,
  errors             jsonb not null default '[]'::jsonb,
  error_message      text,
  uploaded_by        uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  extracted_at       timestamptz,
  unique (storage_bucket, storage_path),
  constraint project_sources_byte_size_positive check (byte_size > 0),
  constraint project_sources_sha256_format check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$')
);

-- ---------------------------------------------------------------------------
-- source_files: un file estratto dall'archivio
-- ---------------------------------------------------------------------------
create table public.source_files (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid not null references public.project_sources (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  original_path   text not null,      -- percorso cosi' come appare nell'archivio
  normalized_path text not null,      -- percorso ripulito e verificato
  directory       text not null default '',
  filename        text not null,
  extension       text not null default '',
  kind            source_file_kind not null default 'other',
  byte_size       bigint not null default 0,
  sha256          text not null,
  storage_path    text,               -- valorizzato solo per i binari conservati
  text_content    text,               -- valorizzato per i file testuali
  word_count      integer not null default 0,
  line_count      integer not null default 0,
  is_ignored      boolean not null default false,
  ignore_reason   text,
  created_at      timestamptz not null default now(),
  unique (source_id, normalized_path),
  constraint source_files_sha256_format check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint source_files_no_traversal check (
    normalized_path !~ '(^|/)\.\.(/|$)' and normalized_path !~ '^/'
  )
);

-- ---------------------------------------------------------------------------
-- source_chunks: porzioni indicizzabili di un file testuale
-- ---------------------------------------------------------------------------
create table public.source_chunks (
  id              uuid primary key default gen_random_uuid(),
  source_file_id  uuid not null references public.source_files (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  chunk_index     integer not null,
  heading_path    text[] not null default '{}',
  content         text not null,
  char_count      integer not null default 0,
  token_estimate  integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (source_file_id, chunk_index),
  constraint source_chunks_index_non_negative check (chunk_index >= 0)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809120004_editorial.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 04 · Struttura editoriale: manifesto, parti, capitoli, versioni
-- =============================================================================

-- ---------------------------------------------------------------------------
-- project_manifests: la fonte di verita' della struttura dell'opera.
-- Versionato: rigenerare il manifesto non distrugge quello precedente.
-- ---------------------------------------------------------------------------
create table public.project_manifests (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_id       uuid references public.project_sources (id) on delete set null,
  version         integer not null default 1,
  title           text not null,
  subtitle        text,
  author          text not null default '',
  volume          text,
  structure       jsonb not null default '{}'::jsonb,   -- albero completo
  stats           jsonb not null default '{}'::jsonb,   -- conteggi aggregati
  discrepancies   jsonb not null default '[]'::jsonb,   -- indice dichiarato vs cartelle reali
  is_current      boolean not null default true,
  generated_by    uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (project_id, version),
  constraint project_manifests_version_positive check (version > 0)
);

-- Un solo manifesto corrente per progetto.
create unique index project_manifests_one_current
  on public.project_manifests (project_id)
  where is_current;

-- ---------------------------------------------------------------------------
-- publication_parts: parti, appendici, materiale di apertura e chiusura
-- ---------------------------------------------------------------------------
create table public.publication_parts (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  manifest_id     uuid references public.project_manifests (id) on delete set null,
  kind            part_kind not null default 'part',
  number          integer,
  title           text not null,
  order_index     integer not null,
  source_path     text,
  created_at      timestamptz not null default now(),
  unique (project_id, order_index),
  constraint publication_parts_number_positive check (number is null or number > 0)
);

-- ---------------------------------------------------------------------------
-- chapters
-- -----------------------------------------------------------------------------
-- order_index e' l'ordine editoriale reale, calcolato dal numero e non
-- dall'ordinamento alfabetico del nome file: senza di esso il capitolo 11
-- finirebbe subito dopo il capitolo 1.
-- ---------------------------------------------------------------------------
create table public.chapters (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  part_id            uuid references public.publication_parts (id) on delete set null,
  source_file_id     uuid references public.source_files (id) on delete set null,
  kind               part_kind not null default 'part',
  number             integer,
  label              text,          -- '11' oppure 'A': etichetta mostrata all'utente
  title              text not null,
  slug               text not null,
  order_index        integer not null,
  status             chapter_status not null default 'draft',
  word_count         integer not null default 0,
  code_block_count   integer not null default 0,
  heading_count      integer not null default 0,
  figure_count       integer not null default 0,
  placeholder_count  integer not null default 0,
  link_count         integer not null default 0,
  source_path        text,
  current_version_id uuid,          -- FK aggiunta dopo chapter_versions
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, order_index),
  unique (project_id, slug),
  constraint chapters_title_length check (char_length(title) between 1 and 300)
);

create trigger chapters_set_updated_at
  before update on public.chapters
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- chapter_versions
-- -----------------------------------------------------------------------------
-- Append-only. La versione 1 ha origine 'original' e non viene mai modificata:
-- ogni intervento umano o AI aggiunge una riga, non ne sovrascrive una.
-- ---------------------------------------------------------------------------
create table public.chapter_versions (
  id               uuid primary key default gen_random_uuid(),
  chapter_id       uuid not null references public.chapters (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  version_no       integer not null,
  origin           version_origin not null default 'original',
  content_md       text not null,
  content_hash     text not null,
  summary          text,
  word_count       integer not null default 0,
  parent_version_id uuid references public.chapter_versions (id) on delete set null,
  workflow_run_id  uuid,   -- FK aggiunta nella migration 05
  agent_run_id     uuid,   -- FK aggiunta nella migration 05
  is_approved      boolean not null default false,
  approved_by      uuid references auth.users (id) on delete set null,
  approved_at      timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (chapter_id, version_no),
  constraint chapter_versions_version_positive check (version_no > 0),
  constraint chapter_versions_hash_format check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint chapter_versions_approval_coherent check (
    (is_approved and approved_at is not null) or (not is_approved and approved_at is null)
  )
);

alter table public.chapters
  add constraint chapters_current_version_fkey
  foreign key (current_version_id) references public.chapter_versions (id) on delete set null;

-- Il contenuto originale e' immutabile: nessun UPDATE su una versione 'original'.
create or replace function public.protect_original_version()
returns trigger
language plpgsql
as $$
begin
  if old.origin = 'original' and new.content_md is distinct from old.content_md then
    raise exception 'La versione originale del capitolo e'' immutabile: crea una nuova versione.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger chapter_versions_protect_original
  before update on public.chapter_versions
  for each row execute function public.protect_original_version();

-- ---------------------------------------------------------------------------
-- citations
-- ---------------------------------------------------------------------------
create table public.citations (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  chapter_id         uuid references public.chapters (id) on delete cascade,
  chapter_version_id uuid references public.chapter_versions (id) on delete set null,
  url                text not null,
  title              text,
  publisher          text,
  is_official        boolean not null default false,
  http_status        integer,
  last_checked_at    timestamptz,
  is_reachable       boolean,
  note               text,
  created_at         timestamptz not null default now(),
  constraint citations_url_scheme check (url ~* '^https?://')
);

-- ---------------------------------------------------------------------------
-- style_guides
-- ---------------------------------------------------------------------------
create table public.style_guides (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id      uuid references public.projects (id) on delete cascade,
  name            text not null,
  version         integer not null default 1,
  tone            text,
  terminology     jsonb not null default '{}'::jsonb,
  rules           jsonb not null default '{}'::jsonb,
  palette         jsonb not null default '{}'::jsonb,
  is_default      boolean not null default false,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger style_guides_set_updated_at
  before update on public.style_guides
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809120005_agents_workflows.sql
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809120006_reviews.sql
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809120007_visual_cover.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 07 · Asset visuali e Cover Studio
-- =============================================================================

-- ---------------------------------------------------------------------------
-- visual_assets
-- -----------------------------------------------------------------------------
-- Un'unica tabella per diagrammi deterministici (Mermaid/SVG) e illustrazioni
-- generate da un modello: `generator` li distingue. I campi di riproducibilita'
-- (prompt, seed, modello) sono valorizzati solo per gli asset AI.
-- ---------------------------------------------------------------------------
create table public.visual_assets (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  chapter_id       uuid references public.chapters (id) on delete cascade,
  agent_run_id     uuid references public.agent_runs (id) on delete set null,
  kind             asset_kind not null default 'diagram',
  generator        asset_generator not null default 'svg',
  status           asset_status not null default 'draft',
  version          integer not null default 1,
  parent_asset_id  uuid references public.visual_assets (id) on delete set null,
  title            text,
  caption          text,
  alt_text         text,
  prompt           text,
  negative_prompt  text,
  provider         text,
  model            text,
  seed             bigint,
  width            integer,
  height           integer,
  style            text,
  mermaid_source   text,
  svg_source       text,
  storage_bucket   text default 'generated-assets',
  storage_path     text,
  cost_usd         numeric(12, 6) not null default 0,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  approved_by      uuid references auth.users (id) on delete set null,
  approved_at      timestamptz,
  constraint visual_assets_version_positive check (version > 0),
  constraint visual_assets_dimensions_positive check (
    (width is null or width > 0) and (height is null or height > 0)
  ),
  constraint visual_assets_approval_coherent check (
    (status = 'approved' and approved_at is not null) or (status <> 'approved')
  ),
  -- Un asset deve avere un contenuto: sorgente deterministico oppure file.
  constraint visual_assets_has_content check (
    mermaid_source is not null or svg_source is not null or storage_path is not null
  ),
  -- Un asset AI deve conservare il prompt che lo ha prodotto.
  constraint visual_assets_ai_has_prompt check (
    generator <> 'ai' or prompt is not null
  )
);

-- ---------------------------------------------------------------------------
-- cover_projects
-- -----------------------------------------------------------------------------
-- La larghezza del dorso NON ha un valore universale: dipende dal fornitore di
-- stampa. Viene calcolata solo quando il numero definitivo di pagine e' noto.
-- ---------------------------------------------------------------------------
create table public.cover_projects (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  name                 text not null default 'Copertina principale',
  page_format          text not null default 'custom',
  trim_width_mm        numeric(7, 2) not null,
  trim_height_mm       numeric(7, 2) not null,
  bleed_mm             numeric(5, 2) not null default 3,
  safety_margin_mm     numeric(5, 2) not null default 5,
  page_count           integer,
  paper_type           text,
  -- Parametro della formula: mm per pagina, pagine per pollice, oppure valore fisso.
  spine_formula        spine_formula not null default 'mm_per_page',
  spine_factor         numeric(10, 5),
  spine_width_mm       numeric(7, 2),
  spine_locked         boolean not null default false,
  title                text not null default '',
  subtitle             text,
  author               text not null default '',
  series_name          text,
  back_description     text,
  biography            text,
  isbn                 text,
  price                numeric(10, 2),
  currency             text not null default 'EUR',
  front_asset_id       uuid references public.visual_assets (id) on delete set null,
  back_asset_id        uuid references public.visual_assets (id) on delete set null,
  spine_asset_id       uuid references public.visual_assets (id) on delete set null,
  series_logo_asset_id uuid references public.visual_assets (id) on delete set null,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint cover_projects_trim_positive check (trim_width_mm > 0 and trim_height_mm > 0),
  constraint cover_projects_bleed_non_negative check (bleed_mm >= 0 and safety_margin_mm >= 0),
  constraint cover_projects_page_count_positive check (page_count is null or page_count > 0),
  constraint cover_projects_spine_non_negative check (spine_width_mm is null or spine_width_mm >= 0),
  -- Il dorso non puo' essere considerato definitivo senza numero di pagine.
  constraint cover_projects_spine_needs_pages check (
    not spine_locked or (page_count is not null and spine_width_mm is not null)
  ),
  constraint cover_projects_isbn_format check (
    isbn is null or isbn ~ '^(97[89])?[0-9]{9}[0-9Xx]$'
  )
);

create trigger cover_projects_set_updated_at
  before update on public.cover_projects
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809120008_publication.sql
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809120009_rls.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 09 · Row Level Security
-- -----------------------------------------------------------------------------
-- Regola generale: un utente vede e modifica soltanto i dati delle
-- organizzazioni di cui e' membro.
--
-- FORCE ROW LEVEL SECURITY applica le policy anche al proprietario della
-- tabella: senza di esso, un ruolo che possiede la tabella le ignorerebbe.
-- Il service role resta esente (bypassrls) ed e' confinato al server.
-- =============================================================================

-- Il ruolo anonimo non ha alcun accesso ai dati editoriali.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- ---------------------------------------------------------------------------
-- Abilitazione
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  protected_tables text[] := array[
    'profiles', 'organizations', 'organization_members',
    'projects', 'project_sources', 'source_files', 'source_chunks',
    'project_manifests', 'publication_parts', 'chapters', 'chapter_versions',
    'citations', 'style_guides',
    'agent_definitions', 'workflow_runs', 'agent_runs', 'verification_issues',
    'review_requests', 'review_comments',
    'visual_assets', 'cover_projects',
    'publication_outputs', 'exports', 'usage_events', 'audit_log'
  ];
begin
  foreach t in array protected_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: ognuno vede e modifica soltanto il proprio profilo
-- ---------------------------------------------------------------------------
create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create policy organizations_select_member on public.organizations
  for select to authenticated using (public.is_org_member(id));

create policy organizations_insert_self on public.organizations
  for insert to authenticated with check (created_by = auth.uid());

create policy organizations_update_admin on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::member_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::member_role[]));

create policy organizations_delete_owner on public.organizations
  for delete to authenticated
  using (public.has_org_role(id, array['owner']::member_role[]));

-- ---------------------------------------------------------------------------
-- organization_members
-- La lettura passa da is_org_member(), che e' SECURITY DEFINER: senza di essa
-- la policy interrogherebbe la tabella su cui e' definita, entrando in ricorsione.
-- ---------------------------------------------------------------------------
create policy organization_members_select on public.organization_members
  for select to authenticated using (public.is_org_member(organization_id));

create policy organization_members_write_admin on public.organization_members
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::member_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::member_role[]));

-- ---------------------------------------------------------------------------
-- agent_definitions: catalogo condiviso, in sola lettura per gli utenti
-- ---------------------------------------------------------------------------
create policy agent_definitions_select on public.agent_definitions
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Tabelle con organization_id: una policy uniforme per tutte
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  org_tables text[] := array[
    'projects', 'project_sources', 'source_files', 'source_chunks',
    'project_manifests', 'publication_parts', 'chapters', 'chapter_versions',
    'citations', 'style_guides',
    'workflow_runs', 'agent_runs', 'verification_issues',
    'review_requests', 'review_comments',
    'visual_assets', 'cover_projects',
    'publication_outputs', 'exports'
  ];
begin
  foreach t in array org_tables loop
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
end;
$$;

-- ---------------------------------------------------------------------------
-- usage_events e audit_log: lettura riservata, scrittura solo lato server
-- ---------------------------------------------------------------------------
create policy usage_events_select_member on public.usage_events
  for select to authenticated using (public.is_org_member(organization_id));

create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (
    organization_id is not null
    and public.has_org_role(organization_id, array['owner', 'admin']::member_role[])
  );

-- Nessuna policy di INSERT su usage_events e audit_log: con RLS attiva e
-- nessuna policy permissiva, la scrittura dal client e' negata. Solo il
-- service role, che ignora la RLS, puo' registrare consumi ed eventi.

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809120010_storage.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 10 · Bucket di storage privati e relative policy
-- -----------------------------------------------------------------------------
-- Nessun bucket e' pubblico: ZIP sorgenti, PDF e asset generati sono
-- raggiungibili solo tramite URL firmati a scadenza, emessi dal server dopo
-- aver verificato l'appartenenza all'organizzazione.
--
-- Convenzione di percorso, identica nei tre bucket:
--     {organization_id}/{project_id}/...
-- Il primo segmento e' quindi sempre l'organizzazione: le policy lo usano per
-- decidere, senza dover interrogare altre tabelle.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'project-sources',
    'project-sources',
    false,
    1073741824,  -- 1 GiB
    array['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
  ),
  (
    'generated-assets',
    'generated-assets',
    false,
    52428800,    -- 50 MiB
    array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
  ),
  (
    'publication-exports',
    'publication-exports',
    false,
    536870912,   -- 512 MiB
    array['application/pdf', 'text/markdown', 'text/html', 'application/json', 'application/zip']
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Estrae l'organizzazione dal primo segmento del percorso dell'oggetto.
-- ---------------------------------------------------------------------------
create or replace function public.storage_object_org(object_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  first_segment text;
begin
  first_segment := split_part(object_name, '/', 1);
  if first_segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return first_segment::uuid;
exception
  when others then
    return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Policy sugli oggetti: solo i membri dell'organizzazione indicata dal percorso.
-- ---------------------------------------------------------------------------
do $$
declare
  b text;
  buckets text[] := array['project-sources', 'generated-assets', 'publication-exports'];
begin
  foreach b in array buckets loop
    execute format($p$
      create policy %I on storage.objects
        for select to authenticated
        using (
          bucket_id = %L
          and public.storage_object_org(name) is not null
          and public.is_org_member(public.storage_object_org(name))
        )
    $p$, b || '_select_member', b);

    execute format($p$
      create policy %I on storage.objects
        for insert to authenticated
        with check (
          bucket_id = %L
          and public.storage_object_org(name) is not null
          and public.is_org_member(public.storage_object_org(name))
        )
    $p$, b || '_insert_member', b);

    execute format($p$
      create policy %I on storage.objects
        for update to authenticated
        using (
          bucket_id = %L
          and public.storage_object_org(name) is not null
          and public.is_org_member(public.storage_object_org(name))
        )
    $p$, b || '_update_member', b);

    execute format($p$
      create policy %I on storage.objects
        for delete to authenticated
        using (
          bucket_id = %L
          and public.storage_object_org(name) is not null
          and public.is_org_member(public.storage_object_org(name))
        )
    $p$, b || '_delete_member', b);
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809120011_indexes.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 11 · Indici
-- -----------------------------------------------------------------------------
-- PostgreSQL non indicizza automaticamente le foreign key: senza questi indici
-- ogni cancellazione a cascata e ogni filtro per organizzazione richiederebbe
-- una scansione sequenziale.
-- =============================================================================

-- Identita'
create index organization_members_user_idx on public.organization_members (user_id);
create index organizations_created_by_idx on public.organizations (created_by);

-- Progetti e sorgenti
create index projects_org_idx on public.projects (organization_id, updated_at desc);
create index projects_created_by_idx on public.projects (created_by);

create index project_sources_project_idx on public.project_sources (project_id, created_at desc);
create index project_sources_org_idx on public.project_sources (organization_id);
create index project_sources_status_idx on public.project_sources (status) where status <> 'extracted';

create index source_files_source_idx on public.source_files (source_id);
create index source_files_project_kind_idx on public.source_files (project_id, kind);
create index source_files_org_idx on public.source_files (organization_id);
-- Individuazione dei duplicati: stesso contenuto in percorsi diversi.
create index source_files_sha256_idx on public.source_files (project_id, sha256);

create index source_chunks_file_idx on public.source_chunks (source_file_id, chunk_index);
create index source_chunks_project_idx on public.source_chunks (project_id);

-- Struttura editoriale
create index project_manifests_project_idx on public.project_manifests (project_id, version desc);
create index publication_parts_project_idx on public.publication_parts (project_id, order_index);
create index chapters_project_order_idx on public.chapters (project_id, order_index);
create index chapters_part_idx on public.chapters (part_id);
create index chapters_org_idx on public.chapters (organization_id);
create index chapters_source_file_idx on public.chapters (source_file_id);
create index chapters_current_version_idx on public.chapters (current_version_id);

create index chapter_versions_chapter_idx on public.chapter_versions (chapter_id, version_no desc);
create index chapter_versions_project_idx on public.chapter_versions (project_id);
create index chapter_versions_workflow_idx on public.chapter_versions (workflow_run_id);
create index chapter_versions_approved_idx on public.chapter_versions (chapter_id) where is_approved;

create index citations_chapter_idx on public.citations (chapter_id);
create index citations_project_idx on public.citations (project_id);
create index style_guides_org_idx on public.style_guides (organization_id);
create index style_guides_project_idx on public.style_guides (project_id);

-- Agenti e workflow
create index workflow_runs_project_idx on public.workflow_runs (project_id, created_at desc);
create index workflow_runs_chapter_idx on public.workflow_runs (chapter_id);
create index workflow_runs_org_idx on public.workflow_runs (organization_id);
-- Pannello "workflow attivi" della dashboard.
create index workflow_runs_active_idx on public.workflow_runs (organization_id, status)
  where status in ('queued', 'running', 'awaiting_approval');
create index workflow_runs_external_idx on public.workflow_runs (external_run_id);

create index agent_runs_workflow_idx on public.agent_runs (workflow_run_id, started_at);
create index agent_runs_project_idx on public.agent_runs (project_id, started_at desc);
create index agent_runs_org_idx on public.agent_runs (organization_id);
create index agent_runs_agent_idx on public.agent_runs (agent_key, status);
-- Riuso di un risultato gia' calcolato per lo stesso input.
create index agent_runs_input_hash_idx on public.agent_runs (agent_key, input_hash);

create index verification_issues_chapter_idx on public.verification_issues (chapter_id, severity);
create index verification_issues_project_idx on public.verification_issues (project_id);
create index verification_issues_open_idx on public.verification_issues (organization_id)
  where status = 'open';

-- Revisione
create index review_requests_chapter_idx on public.review_requests (chapter_id, requested_at desc);
create index review_requests_project_idx on public.review_requests (project_id);
create index review_requests_pending_idx on public.review_requests (organization_id)
  where status = 'pending';
create index review_comments_request_idx on public.review_comments (review_request_id, created_at);
create index review_comments_project_idx on public.review_comments (project_id);

-- Visual e copertine
create index visual_assets_project_idx on public.visual_assets (project_id, created_at desc);
create index visual_assets_chapter_idx on public.visual_assets (chapter_id);
create index visual_assets_org_idx on public.visual_assets (organization_id);
create index visual_assets_pending_idx on public.visual_assets (organization_id)
  where status = 'pending_approval';
create index visual_assets_parent_idx on public.visual_assets (parent_asset_id);
create index cover_projects_project_idx on public.cover_projects (project_id);

-- Pubblicazione e consumo
create index publication_outputs_chapter_idx on public.publication_outputs (chapter_id, kind);
create index publication_outputs_project_idx on public.publication_outputs (project_id, created_at desc);
create index exports_project_idx on public.exports (project_id, requested_at desc);
create index exports_org_idx on public.exports (organization_id);
create index exports_chapter_idx on public.exports (chapter_id);
create index usage_events_org_idx on public.usage_events (organization_id, occurred_at desc);
create index usage_events_agent_run_idx on public.usage_events (agent_run_id);
create index audit_log_org_idx on public.audit_log (organization_id, occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id);

-- ---------------------------------------------------------------------------
-- Copertura completa delle chiavi esterne
-- -----------------------------------------------------------------------------
-- Regola adottata: ogni FK a colonna singola ha un indice che la usa come
-- prima colonna, con una sola eccezione motivata — le colonne che indicano
-- l'autore di un'azione (created_by, approved_by, requested_by, decided_by,
-- resolved_by, uploaded_by, generated_by, started_by, actor_id) referenziano
-- auth.users con ON DELETE SET NULL. Sono scritte spessissimo e interrogate
-- quasi mai: indicizzarle costerebbe piu' di quanto renda.
-- Il test tests/db/schema.test.ts verifica questa regola.
-- ---------------------------------------------------------------------------
create index agent_runs_chapter_idx on public.agent_runs (chapter_id);
create index chapter_versions_org_idx on public.chapter_versions (organization_id);
create index chapter_versions_agent_run_idx on public.chapter_versions (agent_run_id);
create index chapter_versions_parent_idx on public.chapter_versions (parent_version_id);
create index citations_org_idx on public.citations (organization_id);
create index citations_version_idx on public.citations (chapter_version_id);
create index cover_projects_org_idx on public.cover_projects (organization_id);
create index cover_projects_front_asset_idx on public.cover_projects (front_asset_id);
create index cover_projects_back_asset_idx on public.cover_projects (back_asset_id);
create index cover_projects_spine_asset_idx on public.cover_projects (spine_asset_id);
create index cover_projects_series_logo_idx on public.cover_projects (series_logo_asset_id);
create index exports_output_idx on public.exports (publication_output_id);
create index project_manifests_org_idx on public.project_manifests (organization_id);
create index project_manifests_source_idx on public.project_manifests (source_id);
create index publication_outputs_org_idx on public.publication_outputs (organization_id);
create index publication_outputs_version_idx on public.publication_outputs (chapter_version_id);
create index publication_outputs_workflow_idx on public.publication_outputs (workflow_run_id);
create index publication_parts_org_idx on public.publication_parts (organization_id);
create index publication_parts_manifest_idx on public.publication_parts (manifest_id);
create index review_comments_org_idx on public.review_comments (organization_id);
create index review_requests_workflow_idx on public.review_requests (workflow_run_id);
create index review_requests_base_version_idx on public.review_requests (base_version_id);
create index review_requests_proposed_version_idx on public.review_requests (proposed_version_id);
create index source_chunks_org_idx on public.source_chunks (organization_id);
create index usage_events_project_idx on public.usage_events (project_id);
create index verification_issues_agent_run_idx on public.verification_issues (agent_run_id);
create index verification_issues_workflow_idx on public.verification_issues (workflow_run_id);
create index visual_assets_agent_run_idx on public.visual_assets (agent_run_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809120012_seed_agents.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 12 · Catalogo dei dodici agenti
-- -----------------------------------------------------------------------------
-- `implemented` distingue cio' che funziona da cio' che e' soltanto previsto
-- dall'architettura. L'interfaccia legge questo campo: un agente non
-- implementato appare disattivato con la dicitura "Disponibile prossimamente",
-- mai come funzionante.
--
-- Alla Fase 2 nessun agente e' ancora operativo: l'ingestione e' deterministica
-- e non passa da un modello. I flag verranno aggiornati dalla Fase 3.
-- =============================================================================

insert into public.agent_definitions (key, name, description, is_visual, implemented, default_model)
values
  ('ingestion', 'Ingestion Agent',
   'Classifica sorgenti, capitoli, codice e asset, e ricostruisce la struttura dell''opera.',
   false, false, null),

  ('source_auditor', 'Source Auditor',
   'Verifica completezza, attendibilita'' e aggiornamento dei riferimenti citati.',
   false, false, null),

  ('curriculum', 'Curriculum Agent',
   'Controlla ordine didattico, prerequisiti, obiettivi ed esercizi.',
   false, false, null),

  ('technical_verifier', 'Technical Verifier',
   'Analizza SQL, SQLX, JavaScript, configurazioni Dataform e affermazioni tecniche.',
   false, false, null),

  ('technical_writer', 'Technical Writer',
   'Propone revisioni del testo mantenendo lo stile dell''autore.',
   false, false, null),

  ('teaching', 'Teaching Agent',
   'Migliora esempi, analogie, riepiloghi, esercizi e quiz.',
   false, false, null),

  ('visual_art_director', 'Visual Art Director',
   'Definisce stile, palette, tipi di figura e coerenza visiva della collana.',
   true, false, null),

  ('technical_diagram', 'Technical Diagram Agent',
   'Produce Mermaid o SVG deterministici per DAG, pipeline e architetture.',
   true, false, null),

  ('illustration', 'Illustration Agent',
   'Genera illustrazioni concettuali tramite un provider visuale.',
   true, false, null),

  ('cover', 'Cover Agent',
   'Progetta fronte, quarta di copertina e dorso.',
   true, false, null),

  ('editorial_reviewer', 'Editorial Reviewer',
   'Controlla stile, terminologia, duplicazioni e coerenza complessiva.',
   false, false, null),

  ('publishing', 'Publishing Agent',
   'Produce Markdown, HTML, PDF, lezione e articolo dalla versione approvata.',
   false, false, null)
on conflict (key) do update
  set name        = excluded.name,
      description = excluded.description,
      is_visual   = excluded.is_visual,
      updated_at  = now();

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809130001_series.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 13 · Collane editoriali (fondamenta della Fase 8)
-- -----------------------------------------------------------------------------
-- Una collana raccoglie più volumi che devono condividere linea editoriale,
-- didattica e identità visiva, senza perdere le rispettive specificità.
--
-- Questa migration crea SOLO le fondamenta: tabelle, vincoli, RLS. Interfaccia,
-- agenti e workflow multi-volume arrivano con la Fase 8. Progetto completo in
-- docs/series.md.
--
-- ── Decisione di modellazione ────────────────────────────────────────────────
-- `projects` NON riceve `series_id` né `volume_number`: la fonte di verità del
-- legame collana-progetto è `series_volumes`.
--
-- Un volume può esistere senza progetto («Volume 4, previsto per l'autunno» è un
-- elemento di piano prima che di redazione) e un progetto può esistere senza
-- collana. La relazione è opzionale su entrambi i lati e ha attributi propri:
-- data prevista, edizione, ISBN, dipendenze, deroghe. È un'entità, non una
-- colonna. Duplicarla su `projects` creerebbe due percorsi verso la stessa
-- verità, destinati a divergere senza che alcun vincolo se ne accorga.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tipi enumerati
-- ---------------------------------------------------------------------------

create type volume_status as enum (
  'planned', 'draft', 'in_review', 'approved',
  'ready_for_publication', 'published', 'archived'
);

create type volume_level as enum ('introduttivo', 'intermedio', 'avanzato');

-- Come una regola della collana vive dentro un volume.
create type rule_mode as enum ('inherited', 'overridden', 'locked');

create type rule_scope as enum (
  'editorial_line', 'tone', 'terminology', 'typography',
  'palette', 'fonts', 'grid', 'image_style', 'diagram_style',
  'cover_template', 'spine_structure', 'back_cover_structure',
  'front_matter', 'back_matter', 'code_conventions',
  'callout_conventions', 'citation_format', 'export_config'
);

create type series_style_kind as enum ('editorial', 'visual');

create type cross_volume_relation as enum (
  'requires', 'deepens', 'independent', 'supersedes', 'complements'
);

create type consistency_dimension as enum (
  'editorial', 'terminology', 'visual', 'curriculum',
  'technical', 'cross_reference', 'technology_version', 'shared_content'
);

-- Una differenza autorizzata è una deroga dichiarata; una non autorizzata è una
-- divergenza che nessuno ha deciso. Il report deve distinguerle.
create type difference_kind as enum ('authorized', 'unauthorized');

create type change_proposal_status as enum (
  'draft', 'analyzing', 'awaiting_approval', 'approved', 'applied', 'rejected'
);

create type impact_kind as enum (
  'applicabile', 'protetto_da_deroga', 'richiede_nuova_edizione', 'non_interessato'
);

create type shared_content_kind as enum (
  'author_bio', 'series_description', 'copyright', 'disclaimer',
  'acknowledgements', 'conventions', 'lab_structure', 'exercise_template',
  'callout', 'glossary', 'bibliography', 'logo', 'icon_set',
  'graphic_element', 'cross_promo'
);

-- ---------------------------------------------------------------------------
-- series
-- ---------------------------------------------------------------------------
create table public.series (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  slug            text not null,
  description     text,
  curator         text not null default '',
  publisher       text,
  audience        text,
  subject_area    text,
  language        text not null default 'it',
  logo_asset_id   uuid references public.visual_assets (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug),
  constraint series_name_length check (char_length(name) between 2 and 200),
  constraint series_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint series_language_format check (language ~ '^[a-z]{2}$')
);

create trigger series_set_updated_at
  before update on public.series
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- series_members
-- ---------------------------------------------------------------------------
create table public.series_members (
  series_id       uuid not null references public.series (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role            member_role not null default 'editor',
  created_at      timestamptz not null default now(),
  primary key (series_id, user_id)
);

-- ---------------------------------------------------------------------------
-- series_volumes · fonte di verità del legame collana-progetto
-- ---------------------------------------------------------------------------
create table public.series_volumes (
  id                uuid primary key default gen_random_uuid(),
  series_id         uuid not null references public.series (id) on delete cascade,
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  volume_number     integer not null,
  title             text not null,
  subtitle          text,
  authors           text[] not null default '{}',
  description       text,
  topic             text,
  level             volume_level,
  audience          text,
  prerequisites     text[] not null default '{}',
  status            volume_status not null default 'planned',
  planned_date      date,
  published_date    date,
  isbn              text,
  edition           integer not null default 1,
  language          text not null default 'it',
  -- Il progetto editoriale, quando esiste. Un volume pianificato non ne ha
  -- ancora uno, e va bene così.
  project_id        uuid references public.projects (id) on delete set null,
  cover_project_id  uuid references public.cover_projects (id) on delete set null,
  final_page_count  integer,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Il numero di volume è univoco nella collana.
  unique (series_id, volume_number),
  -- Un progetto appartiene a un solo volume, di una sola collana.
  unique (project_id),

  constraint series_volumes_number_positive check (volume_number > 0),
  constraint series_volumes_edition_positive check (edition > 0),
  constraint series_volumes_title_length check (char_length(title) between 1 and 200),
  constraint series_volumes_language_format check (language ~ '^[a-z]{2}$'),
  constraint series_volumes_isbn_format check (
    isbn is null or isbn ~ '^(97[89])?[0-9]{9}[0-9Xx]$'
  ),
  constraint series_volumes_page_count_positive check (
    final_page_count is null or final_page_count > 0
  ),
  -- Un volume pubblicato deve dichiarare quando lo è stato.
  constraint series_volumes_published_has_date check (
    status <> 'published' or published_date is not null
  )
);

create trigger series_volumes_set_updated_at
  before update on public.series_volumes
  for each row execute function public.set_updated_at();

-- Un volume pubblicato non si cancella: la copia stampata esiste comunque.
create or replace function public.protect_published_volume()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'published' then
    raise exception 'Un volume pubblicato non puo'' essere cancellato: archivialo.'
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

create trigger series_volumes_protect_published
  before delete on public.series_volumes
  for each row execute function public.protect_published_volume();

-- ---------------------------------------------------------------------------
-- series_style_versions · linea editoriale e sistema visivo, immutabili
-- ---------------------------------------------------------------------------
create table public.series_style_versions (
  id              uuid primary key default gen_random_uuid(),
  series_id       uuid not null references public.series (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind            series_style_kind not null,
  version         integer not null,
  summary         text,
  -- Motivazione della modifica: senza, fra due anni nessuno sapra' spiegarla.
  rationale       text,
  is_published    boolean not null default false,
  is_current      boolean not null default false,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  published_at    timestamptz,
  unique (series_id, kind, version),
  constraint series_style_versions_version_positive check (version > 0),
  constraint series_style_versions_published_coherent check (
    (is_published and published_at is not null) or (not is_published and published_at is null)
  )
);

-- Una sola versione corrente per collana e per tipo.
create unique index series_style_versions_one_current
  on public.series_style_versions (series_id, kind)
  where is_current;

-- Una versione pubblicata è immutabile: modificarla riscriverebbe la storia.
create or replace function public.protect_published_style_version()
returns trigger
language plpgsql
as $$
begin
  if old.is_published
     and (new.summary is distinct from old.summary
          or new.rationale is distinct from old.rationale
          or new.kind is distinct from old.kind
          or new.version is distinct from old.version) then
    raise exception 'Una versione di stile pubblicata e'' immutabile: creane una nuova.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger series_style_versions_protect_published
  before update on public.series_style_versions
  for each row execute function public.protect_published_style_version();

-- ---------------------------------------------------------------------------
-- series_rules · le singole regole di una versione di stile
-- ---------------------------------------------------------------------------
create table public.series_rules (
  id              uuid primary key default gen_random_uuid(),
  style_version_id uuid not null references public.series_style_versions (id) on delete cascade,
  series_id       uuid not null references public.series (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scope           rule_scope not null,
  key             text not null,
  value           jsonb not null default '{}'::jsonb,
  -- 'locked' impedisce ai volumi di discostarsene.
  mode            rule_mode not null default 'inherited',
  description     text,
  created_at      timestamptz not null default now(),
  unique (style_version_id, scope, key),
  constraint series_rules_key_length check (char_length(key) between 1 and 120),
  -- Una regola della collana non puo' nascere gia' derogata.
  constraint series_rules_mode_valid check (mode in ('inherited', 'locked'))
);

-- ---------------------------------------------------------------------------
-- series_rule_overrides · deroghe di volume
-- ---------------------------------------------------------------------------
create table public.series_rule_overrides (
  id              uuid primary key default gen_random_uuid(),
  volume_id       uuid not null references public.series_volumes (id) on delete cascade,
  series_id       uuid not null references public.series (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scope           rule_scope not null,
  key             text not null,
  value           jsonb not null default '{}'::jsonb,
  -- Obbligatoria: una deroga non spiegata e' indistinguibile da un errore.
  reason          text not null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (volume_id, scope, key),
  constraint series_rule_overrides_reason_present check (char_length(trim(reason)) >= 10)
);

-- Una regola bloccata non ammette deroghe: il tentativo viene rifiutato, non
-- ignorato in silenzio.
create or replace function public.reject_override_on_locked_rule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
      from public.series_rules r
      join public.series_style_versions v on v.id = r.style_version_id
     where v.series_id = new.series_id
       and v.is_current
       and r.scope = new.scope
       and r.key = new.key
       and r.mode = 'locked'
  ) then
    raise exception 'La regola «%» e'' bloccata nella collana e non ammette varianti locali.', new.key
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger series_rule_overrides_respect_locked
  before insert or update on public.series_rule_overrides
  for each row execute function public.reject_override_on_locked_rule();

-- ---------------------------------------------------------------------------
-- Contenuti condivisi · referenziati, mai copiati
-- ---------------------------------------------------------------------------
create table public.series_shared_contents (
  id              uuid primary key default gen_random_uuid(),
  series_id       uuid not null references public.series (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind            shared_content_kind not null,
  key             text not null,
  title           text not null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (series_id, key)
);

create trigger series_shared_contents_set_updated_at
  before update on public.series_shared_contents
  for each row execute function public.set_updated_at();

create table public.series_shared_content_versions (
  id                 uuid primary key default gen_random_uuid(),
  shared_content_id  uuid not null references public.series_shared_contents (id) on delete cascade,
  series_id          uuid not null references public.series (id) on delete cascade,
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  version            integer not null,
  body               text not null,
  content            jsonb not null default '{}'::jsonb,
  is_current         boolean not null default false,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (shared_content_id, version),
  constraint series_shared_content_versions_version_positive check (version > 0)
);

create unique index series_shared_content_versions_one_current
  on public.series_shared_content_versions (shared_content_id)
  where is_current;

-- ---------------------------------------------------------------------------
-- series_terms · glossario condiviso
-- ---------------------------------------------------------------------------
create table public.series_terms (
  id              uuid primary key default gen_random_uuid(),
  series_id       uuid not null references public.series (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  preferred       text not null,
  definition      text not null default '',
  discouraged     text[] not null default '{}',
  synonyms        text[] not null default '{}',
  translation     text,
  abbreviation    text,
  case_sensitive  boolean not null default false,
  source          text,
  editorial_note  text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (series_id, preferred),
  constraint series_terms_preferred_length check (char_length(preferred) between 1 and 200)
);

create trigger series_terms_set_updated_at
  before update on public.series_terms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- series_assets · logo, icone, elementi grafici della collana
-- ---------------------------------------------------------------------------
create table public.series_assets (
  id              uuid primary key default gen_random_uuid(),
  series_id       uuid not null references public.series (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  visual_asset_id uuid references public.visual_assets (id) on delete cascade,
  role            text not null,
  is_fixed        boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (series_id, role)
);

-- ---------------------------------------------------------------------------
-- series_cover_templates · parte fissa e parte variabile
-- ---------------------------------------------------------------------------
create table public.series_cover_templates (
  id               uuid primary key default gen_random_uuid(),
  series_id        uuid not null references public.series (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  style_version_id uuid references public.series_style_versions (id) on delete set null,
  name             text not null default 'Template principale',
  -- Elementi identici in tutta la collana: logo, posizione del titolo, font,
  -- griglia, stile del dorso.
  fixed_elements   jsonb not null default '{}'::jsonb,
  -- Elementi propri del volume: colore, illustrazione, numero, icona.
  variable_elements jsonb not null default '{}'::jsonb,
  trim_width_mm    numeric(7, 2),
  trim_height_mm   numeric(7, 2),
  bleed_mm         numeric(5, 2) not null default 3,
  safety_margin_mm numeric(5, 2) not null default 5,
  is_current       boolean not null default false,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index series_cover_templates_one_current
  on public.series_cover_templates (series_id)
  where is_current;

create trigger series_cover_templates_set_updated_at
  before update on public.series_cover_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- series_release_plans · piano di pubblicazione per volume
-- ---------------------------------------------------------------------------
create table public.series_release_plans (
  id              uuid primary key default gen_random_uuid(),
  series_id       uuid not null references public.series (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  volume_id       uuid references public.series_volumes (id) on delete cascade,
  position        integer not null default 1,
  priority        integer not null default 3,
  planned_start   date,
  planned_release date,
  actual_release  date,
  owner_id        uuid references auth.users (id) on delete set null,
  channels        text[] not null default '{}',
  target          text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (series_id, volume_id),
  constraint series_release_plans_priority_range check (priority between 1 and 5)
);

create trigger series_release_plans_set_updated_at
  before update on public.series_release_plans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Proposte di modifica e loro impatto
-- ---------------------------------------------------------------------------
create table public.series_change_proposals (
  id                  uuid primary key default gen_random_uuid(),
  series_id           uuid not null references public.series (id) on delete cascade,
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  from_style_version_id uuid references public.series_style_versions (id) on delete set null,
  to_style_version_id   uuid references public.series_style_versions (id) on delete set null,
  title               text not null,
  rationale           text not null default '',
  changed_rules       jsonb not null default '[]'::jsonb,
  status              change_proposal_status not null default 'draft',
  requested_by        uuid references auth.users (id) on delete set null,
  requested_at        timestamptz not null default now(),
  decided_by          uuid references auth.users (id) on delete set null,
  decided_at          timestamptz,
  decision_note       text,
  applied_at          timestamptz,
  constraint series_change_proposals_decision_coherent check (
    status in ('draft', 'analyzing', 'awaiting_approval') or decided_at is not null
  )
);

create table public.series_change_impacts (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid not null references public.series_change_proposals (id) on delete cascade,
  series_id       uuid not null references public.series (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  volume_id       uuid not null references public.series_volumes (id) on delete cascade,
  kind            impact_kind not null,
  explanation     text not null default '',
  preview         jsonb not null default '{}'::jsonb,
  -- Vero quando il volume e' gia' pubblicato: serve una nuova edizione, non una
  -- modifica.
  requires_new_edition boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (proposal_id, volume_id)
);

-- ---------------------------------------------------------------------------
-- cross_volume_references
-- ---------------------------------------------------------------------------
create table public.cross_volume_references (
  id                 uuid primary key default gen_random_uuid(),
  series_id          uuid not null references public.series (id) on delete cascade,
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  from_volume_id     uuid not null references public.series_volumes (id) on delete cascade,
  to_volume_id       uuid not null references public.series_volumes (id) on delete cascade,
  relation           cross_volume_relation not null,
  from_chapter_id    uuid references public.chapters (id) on delete set null,
  to_chapter_id      uuid references public.chapters (id) on delete set null,
  note               text,
  -- Passa a falso quando la destinazione cambia numero o scompare.
  is_valid           boolean not null default true,
  last_checked_at    timestamptz,
  created_at         timestamptz not null default now(),
  unique (from_volume_id, to_volume_id, relation, from_chapter_id, to_chapter_id),
  constraint cross_volume_references_not_self check (from_volume_id <> to_volume_id)
);

-- ---------------------------------------------------------------------------
-- Controllo di coerenza
-- ---------------------------------------------------------------------------
create table public.series_consistency_runs (
  id              uuid primary key default gen_random_uuid(),
  series_id       uuid not null references public.series (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workflow_run_id uuid references public.workflow_runs (id) on delete set null,
  status          run_status not null default 'queued',
  dimensions      consistency_dimension[] not null default '{}',
  volumes_checked integer not null default 0,
  issues_found    integer not null default 0,
  summary         text,
  started_by      uuid references auth.users (id) on delete set null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create table public.series_consistency_issues (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.series_consistency_runs (id) on delete cascade,
  series_id       uuid not null references public.series (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  volume_id       uuid references public.series_volumes (id) on delete cascade,
  dimension       consistency_dimension not null,
  severity        issue_severity not null default 'medium',
  status          issue_status not null default 'open',
  -- Distingue una deroga deliberata da una divergenza che nessuno ha deciso.
  difference      difference_kind not null default 'unauthorized',
  title           text not null,
  detail          text,
  rule_violated   text,
  location        jsonb not null default '{}'::jsonb,
  suggestion      text,
  owner_id        uuid references auth.users (id) on delete set null,
  approved_by     uuid references auth.users (id) on delete set null,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint series_consistency_issues_title_length check (char_length(title) between 1 and 300)
);

-- =============================================================================
-- Row Level Security
-- -----------------------------------------------------------------------------
-- Stessa regola del resto dello schema: si vede e si modifica soltanto ciò che
-- appartiene alle organizzazioni di cui si è membri. ENABLE non basta: senza
-- FORCE il proprietario della tabella ignorerebbe le proprie policy.
-- =============================================================================

do $$
declare
  t text;
  series_tables text[] := array[
    'series', 'series_members', 'series_volumes',
    'series_style_versions', 'series_rules', 'series_rule_overrides',
    'series_shared_contents', 'series_shared_content_versions',
    'series_terms', 'series_assets', 'series_cover_templates',
    'series_release_plans', 'series_change_proposals', 'series_change_impacts',
    'cross_volume_references', 'series_consistency_runs', 'series_consistency_issues'
  ];
begin
  foreach t in array series_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

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
end;
$$;

-- =============================================================================
-- Indici
-- -----------------------------------------------------------------------------
-- Stessa regola della migration 11: ogni chiave esterna a colonna singola ha un
-- indice che la usa come prima colonna, tranne le colonne che indicano l'autore
-- di un'azione.
-- =============================================================================

create index series_org_idx on public.series (organization_id, updated_at desc);
create index series_logo_idx on public.series (logo_asset_id);

create index series_members_user_idx on public.series_members (user_id);
create index series_members_org_idx on public.series_members (organization_id);

create index series_volumes_series_idx on public.series_volumes (series_id, volume_number);
create index series_volumes_org_idx on public.series_volumes (organization_id);
create index series_volumes_cover_idx on public.series_volumes (cover_project_id);
-- Pannello «volumi in lavorazione» del cruscotto di collana.
create index series_volumes_active_idx on public.series_volumes (series_id, status)
  where status <> 'archived';

create index series_style_versions_series_idx on public.series_style_versions (series_id, kind, version desc);
create index series_style_versions_org_idx on public.series_style_versions (organization_id);

create index series_rules_version_idx on public.series_rules (style_version_id, scope);
create index series_rules_series_idx on public.series_rules (series_id);
create index series_rules_org_idx on public.series_rules (organization_id);

create index series_rule_overrides_volume_idx on public.series_rule_overrides (volume_id, scope);
create index series_rule_overrides_series_idx on public.series_rule_overrides (series_id);
create index series_rule_overrides_org_idx on public.series_rule_overrides (organization_id);

create index series_shared_contents_series_idx on public.series_shared_contents (series_id, kind);
create index series_shared_contents_org_idx on public.series_shared_contents (organization_id);

create index series_shared_content_versions_content_idx
  on public.series_shared_content_versions (shared_content_id, version desc);
create index series_shared_content_versions_series_idx
  on public.series_shared_content_versions (series_id);
create index series_shared_content_versions_org_idx
  on public.series_shared_content_versions (organization_id);

create index series_terms_series_idx on public.series_terms (series_id);
create index series_terms_org_idx on public.series_terms (organization_id);

create index series_assets_series_idx on public.series_assets (series_id);
create index series_assets_org_idx on public.series_assets (organization_id);
create index series_assets_visual_idx on public.series_assets (visual_asset_id);

create index series_cover_templates_series_idx on public.series_cover_templates (series_id);
create index series_cover_templates_org_idx on public.series_cover_templates (organization_id);
create index series_cover_templates_style_idx on public.series_cover_templates (style_version_id);

create index series_release_plans_series_idx on public.series_release_plans (series_id, position);
create index series_release_plans_org_idx on public.series_release_plans (organization_id);
create index series_release_plans_volume_idx on public.series_release_plans (volume_id);

create index series_change_proposals_series_idx
  on public.series_change_proposals (series_id, requested_at desc);
create index series_change_proposals_org_idx on public.series_change_proposals (organization_id);
create index series_change_proposals_from_idx on public.series_change_proposals (from_style_version_id);
create index series_change_proposals_to_idx on public.series_change_proposals (to_style_version_id);
create index series_change_proposals_pending_idx on public.series_change_proposals (organization_id)
  where status = 'awaiting_approval';

create index series_change_impacts_proposal_idx on public.series_change_impacts (proposal_id);
create index series_change_impacts_series_idx on public.series_change_impacts (series_id);
create index series_change_impacts_org_idx on public.series_change_impacts (organization_id);
create index series_change_impacts_volume_idx on public.series_change_impacts (volume_id);

create index cross_volume_references_series_idx on public.cross_volume_references (series_id);
create index cross_volume_references_org_idx on public.cross_volume_references (organization_id);
create index cross_volume_references_from_idx on public.cross_volume_references (from_volume_id);
create index cross_volume_references_to_idx on public.cross_volume_references (to_volume_id);
create index cross_volume_references_from_chapter_idx on public.cross_volume_references (from_chapter_id);
create index cross_volume_references_to_chapter_idx on public.cross_volume_references (to_chapter_id);
-- Riferimenti da ricontrollare dopo una rinumerazione.
create index cross_volume_references_invalid_idx on public.cross_volume_references (series_id)
  where not is_valid;

create index series_consistency_runs_series_idx
  on public.series_consistency_runs (series_id, started_at desc);
create index series_consistency_runs_org_idx on public.series_consistency_runs (organization_id);
create index series_consistency_runs_workflow_idx on public.series_consistency_runs (workflow_run_id);

create index series_consistency_issues_run_idx
  on public.series_consistency_issues (run_id, severity);
create index series_consistency_issues_series_idx on public.series_consistency_issues (series_id);
create index series_consistency_issues_org_idx on public.series_consistency_issues (organization_id);
create index series_consistency_issues_volume_idx on public.series_consistency_issues (volume_id);
-- Il report utile mostra solo le divergenze che nessuno ha deciso.
create index series_consistency_issues_unauthorized_idx
  on public.series_consistency_issues (series_id)
  where status = 'open' and difference = 'unauthorized';

-- =============================================================================
-- Catalogo dei sei agenti di collana
-- -----------------------------------------------------------------------------
-- Registrati con implemented = false: l'interfaccia li mostra disattivati, mai
-- come funzionanti. I flag passeranno a true quando lo saranno davvero.
-- =============================================================================

alter type agent_key add value if not exists 'series_architect';
alter type agent_key add value if not exists 'series_curriculum';
alter type agent_key add value if not exists 'series_consistency';
alter type agent_key add value if not exists 'series_visual_director';
alter type agent_key add value if not exists 'cross_volume_reference';
alter type agent_key add value if not exists 'series_publishing';

-- ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
--
--   ⚠  INTERRUZIONE OBBLIGATORIA — SOLO PER L'SQL EDITOR
--
--   Se stai incollando questo file nell'SQL Editor di Supabase, fermati qui:
--   esegui tutto ciò che precede, attendi il completamento, poi esegui
--   separatamente ciò che segue.
--
--   Motivo: PostgreSQL non permette di usare un valore di enum nella stessa
--   transazione in cui viene aggiunto con ALTER TYPE ... ADD VALUE.
--
--   Con `npx supabase db push` questa interruzione non serve: ogni migration
--   è già una transazione a sé.
--
-- ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809130002_series_agents.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 14 · Registrazione degli agenti di collana
-- -----------------------------------------------------------------------------
-- File separato per necessità: PostgreSQL non consente di usare un valore di
-- enum nella stessa transazione in cui viene aggiunto con ALTER TYPE ... ADD
-- VALUE. I valori sono introdotti dalla migration 13; qui vengono impiegati.
--
-- Tutti con implemented = false: l'architettura è predisposta, il comportamento
-- no. L'interfaccia li mostra disattivati, mai come funzionanti.
-- =============================================================================

insert into public.agent_definitions (key, name, description, is_visual, implemented, default_model)
values
  ('series_architect', 'Series Architect Agent',
   'Progetta struttura e roadmap di una collana editoriale.',
   false, false, null),

  ('series_curriculum', 'Series Curriculum Agent',
   'Verifica progressione della difficolta'', prerequisiti fra volumi, concetti usati prima di essere spiegati, lacune e sovrapposizioni.',
   false, false, null),

  ('series_consistency', 'Series Consistency Agent',
   'Controlla coerenza editoriale, terminologica, visiva, didattica e tecnica fra i volumi, distinguendo le differenze autorizzate da quelle non autorizzate.',
   false, false, null),

  ('series_visual_director', 'Series Visual Director',
   'Governa l''identita'' visiva condivisa e le differenze controllate fra volumi.',
   true, false, null),

  ('cross_volume_reference', 'Cross-Volume Reference Agent',
   'Gestisce riferimenti e collegamenti fra volumi, segnalando quando la destinazione cambia.',
   false, false, null),

  ('series_publishing', 'Series Publishing Agent',
   'Produce catalogo, schede dei volumi e materiali promozionali dell''intera collana.',
   false, false, null)
on conflict (key) do update
  set name        = excluded.name,
      description = excluded.description,
      is_visual   = excluded.is_visual,
      updated_at  = now();

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809140001_source_research.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 15 · Ricerca automatica delle fonti
-- -----------------------------------------------------------------------------
-- Le fonti che il Source Auditor trova nell'indice curato non sono citazioni:
-- sono proposte. Vivono in una tabella distinta finché un revisore non le
-- accetta, momento in cui diventano una riga di `citations`.
--
-- Tenerle separate ha una conseguenza precisa: `citations` continua a
-- descrivere che cosa il capitolo cita davvero, senza mescolarvi ciò che la
-- macchina suggerisce.
-- =============================================================================

create type source_suggestion_status as enum ('proposed', 'accepted', 'rejected');

create table public.source_suggestions (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  chapter_id       uuid not null references public.chapters (id) on delete cascade,
  workflow_run_id  uuid references public.workflow_runs (id) on delete cascade,

  -- L'affermazione da sostenere, così come si presentava al momento dell'audit.
  claim_line       integer not null,
  claim_excerpt    text not null,
  category         text not null,

  -- La pagina proposta, letta dall'indice: url e titolo non sono generati.
  url              text not null,
  title            text not null,
  section          text,
  score            numeric(8, 3) not null,
  rank             integer not null,
  -- I termini che hanno prodotto l'aggancio: è il motivo della proposta, ed è
  -- ciò che il revisore legge per accettarla o scartarla.
  matched_terms    text[] not null default '{}',

  status           source_suggestion_status not null default 'proposed',
  decided_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),

  constraint source_suggestions_url_https check (url ~* '^https://'),
  constraint source_suggestions_rank_positive check (rank >= 1),
  constraint source_suggestions_line_valid check (claim_line >= 0),
  -- Una decisione ha sempre un momento; l'assenza di decisione non ne ha uno.
  constraint source_suggestions_decision_coherent check (
    (status = 'proposed' and decided_at is null)
    or (status <> 'proposed' and decided_at is not null)
  )
);

comment on table public.source_suggestions is
  'Fonti ufficiali proposte automaticamente per le affermazioni prive di rimando. Una proposta non è una citazione finché un revisore non la accetta.';

-- ---------------------------------------------------------------------------
-- Indici
-- ---------------------------------------------------------------------------
create index source_suggestions_chapter_idx
  on public.source_suggestions (chapter_id, claim_line, rank);
create index source_suggestions_run_idx
  on public.source_suggestions (workflow_run_id);
create index source_suggestions_org_idx
  on public.source_suggestions (organization_id);
create index source_suggestions_project_idx
  on public.source_suggestions (project_id, created_at desc);
-- Le proposte ancora da decidere sono l'unico sottoinsieme interrogato spesso.
create index source_suggestions_pending_idx
  on public.source_suggestions (chapter_id)
  where status = 'proposed';

-- ---------------------------------------------------------------------------
-- Row Level Security: la stessa regola delle altre tabelle editoriali
-- ---------------------------------------------------------------------------
alter table public.source_suggestions enable row level security;
alter table public.source_suggestions force row level security;

create policy source_suggestions_select_member on public.source_suggestions
  for select to authenticated using (public.is_org_member(organization_id));

create policy source_suggestions_insert_member on public.source_suggestions
  for insert to authenticated with check (public.is_org_member(organization_id));

create policy source_suggestions_update_member on public.source_suggestions
  for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy source_suggestions_delete_member on public.source_suggestions
  for delete to authenticated using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- Citazioni: distinguere «verificata» da «mai controllata»
-- ---------------------------------------------------------------------------
-- `is_reachable` resta nullo per ciò che non è stato interrogato: un controllo
-- contro l'indice curato non è una chiamata HTTP, e dichiararlo tale sarebbe
-- una piccola bugia con conseguenze pratiche.
comment on column public.citations.is_reachable is
  'Vero se la pagina risulta nell''indice curato delle fonti ufficiali. Nullo se non è stata controllata.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809140002_reference_library.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 16 · Biblioteca delle fonti
-- -----------------------------------------------------------------------------
-- L'indice ufficiale copre la documentazione del produttore. Un manuale però si
-- appoggia anche ad altro: una specifica in PDF, un articolo, una pagina interna.
-- Questa migration dà a quel materiale lo stesso trattamento — viene indicizzato
-- e la ricerca automatica lo propone — senza confonderlo con la documentazione
-- ufficiale: l'origine resta scritta su ogni proposta.
--
-- Ereditarietà: una fonte con `project_id` nullo appartiene all'organizzazione e
-- vale per tutti i suoi progetti; una con `project_id` valorizzato riguarda quel
-- volume soltanto. È lo schema già adottato per le collane.
-- =============================================================================

create type reference_kind as enum ('link', 'pdf');
create type reference_scope as enum ('organization', 'project');
create type reference_status as enum ('pending', 'indexing', 'indexed', 'failed');

-- Da dove viene una fonte proposta. Il lettore ha diritto di saperlo.
create type source_origin as enum ('catalogo_ufficiale', 'biblioteca');

-- ---------------------------------------------------------------------------
-- reference_sources
-- ---------------------------------------------------------------------------
create table public.reference_sources (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  -- Nullo: fonte dell'organizzazione, ereditata da tutti i progetti.
  project_id         uuid references public.projects (id) on delete cascade,

  kind               reference_kind not null,
  scope              reference_scope not null,

  title              text not null,
  url                text,
  storage_path       text,
  original_filename  text,
  byte_size          bigint,
  publisher          text,
  note               text,

  -- L'autore dichiara che questa fonte vale quanto la documentazione ufficiale
  -- (una specifica, una norma). Non lo decide il sistema: lo decide chi scrive.
  is_authoritative   boolean not null default false,

  status             reference_status not null default 'pending',
  error_message      text,
  chunk_count        integer not null default 0,
  page_count         integer,
  indexed_at         timestamptz,

  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint reference_sources_scope_coherent check (
    (scope = 'organization' and project_id is null)
    or (scope = 'project' and project_id is not null)
  ),
  -- Un link ha un indirizzo, un PDF ha un file. Mai il contrario, mai entrambi.
  constraint reference_sources_target_coherent check (
    (kind = 'link' and url is not null and storage_path is null)
    or (kind = 'pdf' and storage_path is not null and url is null)
  ),
  constraint reference_sources_url_scheme check (url is null or url ~* '^https?://'),
  constraint reference_sources_title_present check (length(btrim(title)) > 0),
  constraint reference_sources_chunk_count check (chunk_count >= 0)
);

comment on table public.reference_sources is
  'Fonti aggiunte a mano — link e PDF — indicizzate e proposte dalla ricerca automatica accanto alla documentazione ufficiale.';

create trigger reference_sources_set_updated_at
  before update on public.reference_sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- reference_chunks
-- ---------------------------------------------------------------------------
-- Il testo indicizzabile, spezzato in blocchi. Per un PDF il blocco porta il
-- numero di pagina: una proposta può così indicare dove guardare, invece di
-- rimandare a un documento di duecento pagine.
create table public.reference_chunks (
  id               uuid primary key default gen_random_uuid(),
  reference_id     uuid not null references public.reference_sources (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  project_id       uuid references public.projects (id) on delete cascade,

  chunk_index      integer not null,
  page             integer,
  heading          text,
  content          text not null,
  -- Termini canonici precalcolati: la ricerca non deve ri-tokenizzare a ogni giro.
  terms            text[] not null default '{}',

  created_at       timestamptz not null default now(),

  constraint reference_chunks_index_positive check (chunk_index >= 0),
  constraint reference_chunks_page_positive check (page is null or page >= 1),
  unique (reference_id, chunk_index)
);

comment on table public.reference_chunks is
  'Testo indicizzabile delle fonti della biblioteca, con il numero di pagina quando la fonte è un PDF.';

-- ---------------------------------------------------------------------------
-- Indici
-- ---------------------------------------------------------------------------
create index reference_sources_org_idx
  on public.reference_sources (organization_id, created_at desc);
create index reference_sources_project_idx
  on public.reference_sources (project_id, created_at desc);
-- Le fonti dell'organizzazione sono lette a ogni ricerca su ogni progetto.
create index reference_sources_inherited_idx
  on public.reference_sources (organization_id)
  where project_id is null;
create index reference_sources_status_idx
  on public.reference_sources (status)
  where status <> 'indexed';

create index reference_chunks_reference_idx
  on public.reference_chunks (reference_id, chunk_index);
create index reference_chunks_org_idx on public.reference_chunks (organization_id);
create index reference_chunks_project_idx on public.reference_chunks (project_id);
create index reference_chunks_terms_idx on public.reference_chunks using gin (terms);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['reference_sources', 'reference_chunks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

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
end;
$$;

-- ---------------------------------------------------------------------------
-- Le proposte dichiarano da dove vengono
-- ---------------------------------------------------------------------------
alter table public.source_suggestions
  add column origin source_origin not null default 'catalogo_ufficiale',
  add column reference_id uuid references public.reference_sources (id) on delete cascade,
  add column page integer;

-- Un PDF caricato non ha un indirizzo pubblico: la proposta lo identifica con
-- la fonte e la pagina. L'URL smette quindi di essere obbligatorio, ma qualcosa
-- che identifichi la fonte deve esserci sempre.
alter table public.source_suggestions alter column url drop not null;
alter table public.source_suggestions drop constraint source_suggestions_url_https;

alter table public.source_suggestions
  add constraint source_suggestions_url_https check (url is null or url ~* '^https://'),
  add constraint source_suggestions_identifiable check (url is not null or reference_id is not null),
  -- Una proposta viene dal catalogo ufficiale oppure dalla biblioteca: nel primo
  -- caso non ha una fonte di progetto alle spalle, nel secondo ce l'ha sempre.
  add constraint source_suggestions_origin_coherent check (
    (origin = 'catalogo_ufficiale' and reference_id is null)
    or (origin = 'biblioteca' and reference_id is not null)
  ),
  add constraint source_suggestions_page_positive check (page is null or page >= 1);

create index source_suggestions_reference_idx
  on public.source_suggestions (reference_id)
  where reference_id is not null;

-- ---------------------------------------------------------------------------
-- Storage: il bucket delle sorgenti accoglie anche i PDF di riferimento
-- ---------------------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = array[
     'application/zip',
     'application/x-zip-compressed',
     'application/octet-stream',
     'application/pdf'
   ]
 where id = 'project-sources';

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809140003_reference_proposed.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 17 · Stato «proposta» per le fonti
-- -----------------------------------------------------------------------------
-- File a sé per necessità: PostgreSQL non consente di usare un valore di enum
-- nella stessa transazione in cui viene aggiunto con ALTER TYPE ... ADD VALUE.
-- Il valore entra qui; la migration 18 lo impiega.
--
-- La ricerca web propone; l'autore dispone. Una fonte trovata automaticamente
-- entra in biblioteca come `proposed` e non viene indicizzata: resta un
-- suggerimento finché qualcuno non la accetta.
-- =============================================================================

alter type reference_status add value if not exists 'proposed';

-- ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
--
--   ⚠  INTERRUZIONE OBBLIGATORIA — SOLO PER L'SQL EDITOR
--
--   Se stai incollando questo file nell'SQL Editor di Supabase, fermati qui:
--   esegui tutto ciò che precede, attendi il completamento, poi esegui
--   separatamente ciò che segue.
--
--   Motivo: PostgreSQL non permette di usare un valore di enum nella stessa
--   transazione in cui viene aggiunto con ALTER TYPE ... ADD VALUE.
--
--   Con `npx supabase db push` questa interruzione non serve: ogni migration
--   è già una transazione a sé.
--
-- ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260809140004_web_discovery.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- 18 · Fonti trovate sul web
-- -----------------------------------------------------------------------------
-- Riusare `reference_sources` invece di una tabella a parte è deliberato: una
-- fonte accettata non deve essere copiata da qualche parte, deve solo cambiare
-- stato. Meno passaggi, meno occasioni di divergenza.
--
-- Impiega lo stato `proposed` introdotto dalla migration 17.
-- =============================================================================

-- Come è entrata in biblioteca. Serve a distinguere ciò che l'autore ha scelto
-- da ciò che gli è stato proposto: la fiducia da accordare non è la stessa.
create type reference_added_by as enum ('manuale', 'ricerca_web');

alter table public.reference_sources
  add column added_by         reference_added_by not null default 'manuale',
  -- Perché questa fonte servirebbe a questo manuale. È ciò che il revisore
  -- legge per decidere: senza motivazione una proposta è solo un URL in più.
  add column rationale        text,
  -- L'interrogazione che l'ha fatta emergere: rende la proposta rintracciabile.
  add column discovery_query  text,
  add column web_kind         text,
  add column priority         integer,
  -- Che cosa ha risposto la pagina quando è stata aperta, e quando.
  add column http_status      integer,
  add column verified_at      timestamptz;

alter table public.reference_sources
  add constraint reference_sources_priority_range
    check (priority is null or priority between 1 and 3),
  -- Una proposta arriva sempre da una ricerca, e porta con sé il perché.
  add constraint reference_sources_proposal_coherent check (
    added_by = 'manuale' or (rationale is not null and discovery_query is not null)
  );

comment on column public.reference_sources.added_by is
  'manuale: aggiunta dall''autore. ricerca_web: proposta dalla ricerca automatica, da accettare.';

-- Le proposte in attesa sono l'unico sottoinsieme interrogato di continuo.
create index reference_sources_proposed_idx
  on public.reference_sources (project_id, priority, created_at desc)
  where status = 'proposed';

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260817220001_realtime.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- Realtime: pubblicazione delle tabelle che alimentano lo stato dal vivo
-- ---------------------------------------------------------------------------
--
-- Senza questa pubblicazione il browser non riceve nulla e la pagina resta
-- ferma finché non la si ricarica a mano. Le policy di lettura già in vigore
-- continuano a valere: Realtime consegna un cambiamento soltanto a chi avrebbe
-- potuto leggerne la riga con una select. Pubblicare una tabella non allarga
-- quindi la visibilità, la estende nel tempo.
--
-- La replica identity resta quella predefinita, la chiave primaria: agli
-- ascoltatori serve la riga nuova, non quella vecchia, e `full` scriverebbe nel
-- WAL molto più del necessario.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

do $$
declare
  t text;
  tabelle text[] := array['workflow_runs', 'agent_runs', 'review_requests'];
begin
  foreach t in array tabelle loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260817230001_editorial_direction.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- Direzione editoriale del progetto: livello, tono, registro
-- ---------------------------------------------------------------------------
--
-- Tre volumi sullo stesso argomento non si distinguono per il titolo: si
-- distinguono per a chi parlano e come. Questi valori entrano nei prompt del
-- Curriculum Agent e del Chapter Drafter, e sono la sola ragione per cui
-- «Dataform base» e «Dataform avanzato» non producono lo stesso libro.
--
-- Sono liste chiuse di proposito. Un tono scritto a mano ogni volta farebbe
-- divergere i volumi per come sono stati descritti invece che per il livello,
-- e il confronto fra loro non direbbe più nulla. Le sfumature che la lista non
-- copre vanno in `style_notes`, dove si vedono e si possono correggere.
--
-- La migrazione è riscrivibile: in questo progetto capita di applicarla
-- incollandola nell'editor SQL, e una seconda esecuzione non deve fallire.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'editorial_level') then
    create type editorial_level as enum ('base', 'intermediate', 'advanced');
  end if;
end;
$$;

alter table public.projects
  add column if not exists level       editorial_level not null default 'base',
  add column if not exists tone        text not null default 'didattico',
  add column if not exists register    text not null default 'tecnico_operativo',
  add column if not exists style_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_tone_allowed'
  ) then
    alter table public.projects
      add constraint projects_tone_allowed
        check (tone in ('didattico', 'professionale', 'discorsivo', 'conciso'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'projects_register_allowed'
  ) then
    alter table public.projects
      add constraint projects_register_allowed
        check (register in ('divulgativo', 'tecnico_operativo', 'rigoroso_formale'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'projects_style_notes_length'
  ) then
    alter table public.projects
      add constraint projects_style_notes_length
        check (style_notes is null or char_length(style_notes) <= 2000);
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260818090001_blog_courses.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Derivazioni editoriali: articoli per il blog e corsi
-- -----------------------------------------------------------------------------
-- Il manuale non è il punto d'arrivo: dallo stesso materiale verificato nascono
-- articoli e corsi. Entrambi passano da un **piano approvabile** prima della
-- stesura, per la stessa ragione per cui i capitoli passano da una revisione —
-- e con una ragione in più, qui: scrivere dieci articoli sbagliati costa dieci
-- volte scriverne uno.
--
-- Gli stati ricalcano quelli già in uso nel progetto: si propone, si approva,
-- si scrive. Nulla nasce pubblicato.
-- =============================================================================

create type content_plan_status as enum ('draft', 'pending_approval', 'approved', 'rejected');
create type content_piece_status as enum ('planned', 'generating', 'drafted', 'approved', 'failed');
create type course_source_kind as enum ('chapters', 'topic');
create type course_format as enum ('autoapprendimento', 'aula', 'video');

-- ---------------------------------------------------------------------------
-- Piano editoriale del blog
-- ---------------------------------------------------------------------------
create table public.blog_plans (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Quanti articoli sono stati chiesti. Il piano può proporne meno se il
  -- materiale non regge: dichiararlo è meglio che riempire.
  requested_count  integer not null,
  status           content_plan_status not null default 'pending_approval',
  summary          text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint blog_plans_count_range check (requested_count between 1 and 30)
);

create trigger blog_plans_set_updated_at
  before update on public.blog_plans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Articoli
-- ---------------------------------------------------------------------------
create table public.blog_articles (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             uuid not null references public.blog_plans (id) on delete cascade,
  project_id          uuid not null references public.projects (id) on delete cascade,
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  position            integer not null,
  title               text not null,
  slug                text,
  -- L'angolo distingue un articolo dall'altro: senza, dieci pezzi sullo stesso
  -- manuale finirebbero a competere fra loro sulle stesse ricerche.
  angle               text not null,
  target_keyword      text,
  secondary_keywords  text[] not null default '{}',
  search_intent       text,
  status              content_piece_status not null default 'planned',
  content_md          text,
  -- Titolo e descrizione per i motori, domande frequenti e dati strutturati
  -- per i sistemi che rispondono citando: qui dentro, non nel corpo.
  seo                 jsonb not null default '{}'::jsonb,
  word_count          integer not null default 0,
  error               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (plan_id, position)
);

create trigger blog_articles_set_updated_at
  before update on public.blog_articles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Corsi
-- ---------------------------------------------------------------------------
create table public.courses (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null default '',
  source_kind      course_source_kind not null,
  -- Valorizzato quando si parte da un argomento libero.
  topic            text,
  -- Valorizzato quando si parte da capitoli scelti.
  chapter_ids      uuid[] not null default '{}',
  level            editorial_level not null default 'base',
  format           course_format not null default 'autoapprendimento',
  lesson_minutes   integer not null default 45,
  lesson_count     integer not null,
  status           content_plan_status not null default 'pending_approval',
  summary          text,
  prerequisites    text[] not null default '{}',
  outcomes         text[] not null default '{}',
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint courses_lesson_count_range check (lesson_count between 1 and 40),
  constraint courses_minutes_range check (lesson_minutes between 10 and 240),
  -- Una sorgente o l'altra, mai nessuna delle due.
  constraint courses_source_coerente check (
    (source_kind = 'topic' and topic is not null and char_length(topic) > 0)
    or (source_kind = 'chapters' and array_length(chapter_ids, 1) is not null)
  )
);

create trigger courses_set_updated_at
  before update on public.courses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Lezioni
-- ---------------------------------------------------------------------------
create table public.course_lessons (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null references public.courses (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  position         integer not null,
  title            text not null,
  intent           text,
  objectives       text[] not null default '{}',
  status           content_piece_status not null default 'planned',
  content_md       text,
  word_count       integer not null default 0,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (course_id, position)
);

create trigger course_lessons_set_updated_at
  before update on public.course_lessons
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Indici e RLS
-- ---------------------------------------------------------------------------
create index blog_articles_plan_idx on public.blog_articles (plan_id, position);
create index blog_plans_project_idx on public.blog_plans (project_id, created_at desc);
create index course_lessons_course_idx on public.course_lessons (course_id, position);
create index courses_project_idx on public.courses (project_id, created_at desc);

do $$
declare
  t text;
  tabelle text[] := array['blog_plans', 'blog_articles', 'courses', 'course_lessons'];
begin
  foreach t in array tabelle loop
    execute format('alter table public.%I enable row level security', t);
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
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260818120001_project_brief.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- Brief del progetto: forma dell'opera, dimensione, ambito
-- ---------------------------------------------------------------------------
--
-- La direzione editoriale dice **come** si scrive; il brief dice **che cosa si
-- sta costruendo**. Senza, il Curriculum Agent conosce il titolo e le fonti e
-- deve indovinare il resto: una guida rapida di cento pagine e il primo volume
-- di una collana partono dallo stesso materiale e producono indici opposti.
--
-- «Fuori ambito» esiste per una ragione precisa: dire cosa un'opera non tratta
-- è spesso più efficace che elencare cosa tratta, e su un manuale tecnico è
-- l'unico modo per impedire che l'indice si allarghi fino a diventare
-- inutilizzabile.
--
-- Migrazione riscrivibile: in questo progetto capita di applicarla incollandola
-- nell'editor SQL.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'work_shape') then
    create type work_shape as enum ('volume_singolo', 'collana', 'guida_rapida');
  end if;
end;
$$;

alter table public.projects
  add column if not exists work_shape   work_shape not null default 'volume_singolo',
  -- Nullo significa «nessun vincolo di lunghezza», non «zero pagine».
  add column if not exists target_pages integer,
  add column if not exists scope        text,
  add column if not exists out_of_scope text,
  add column if not exists audience     text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_target_pages_range') then
    alter table public.projects
      add constraint projects_target_pages_range
        check (target_pages is null or target_pages between 8 and 2000);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'projects_brief_length') then
    alter table public.projects
      add constraint projects_brief_length check (
        (scope is null or char_length(scope) <= 3000)
        and (out_of_scope is null or char_length(out_of_scope) <= 2000)
        and (audience is null or char_length(audience) <= 1000)
      );
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260819100001_blog_courses_rls.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- Row Level Security e indici per corsi e blog
-- -----------------------------------------------------------------------------
-- Le quattro tabelle introdotte con le derivazioni editoriali — `courses`,
-- `course_lessons`, `blog_plans`, `blog_articles` — avevano le policy, ma
-- **senza ENABLE ROW LEVEL SECURITY**. È il caso peggiore: le regole sono
-- scritte, si leggono nel file, sembrano attive — e non vengono applicate,
-- perché una policy su una tabella con RLS spenta non filtra nulla. Un utente
-- autenticato poteva leggere i corsi e gli articoli di **altre organizzazioni**.
--
-- Le policy vengono ricreate qui insieme all'attivazione, così che il file che
-- accende la RLS sia lo stesso che dichiara le regole: separarli è ciò che ha
-- prodotto il difetto.
--
-- Il difetto è stato scoperto dal test `attiva ENABLE e FORCE row level
-- security su ogni tabella esposta`, che non elenca le tabelle da controllare
-- ma le chiede al catalogo: una tabella nuova entra nel controllo da sola, e
-- non c'è modo di dimenticarsene. È il motivo per cui quel test è scritto così.
--
-- FORCE serve oltre a ENABLE: senza, il proprietario della tabella ignorerebbe
-- le policy. Il service role resta esente (bypassrls) ed è confinato al server.
-- =============================================================================

do $$
declare
  t text;
  tabelle text[] := array['courses', 'course_lessons', 'blog_plans', 'blog_articles'];
begin
  foreach t in array tabelle loop
    -- Una migration applicata fuori ordine fallisce con «relation does not
    -- exist», che è vero ma non dice a nessuno che cosa fare. Meglio spendere
    -- cinque righe e spiegarlo: chi legge l'errore sta già cercando di capire.
    if to_regclass(format('public.%I', t)) is null then
      raise exception
        'La tabella public.% non esiste: applica prima la migration che la crea (20260818090001_blog_courses.sql). Con la CLI: npx supabase db push, che applica le migration mancanti nell''ordine giusto.', t
        using errcode = 'undefined_table';
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    -- Idempotente: le policy esistono già, ed è proprio il motivo per cui
    -- l'assenza di ENABLE non si notava.
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_member', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_member', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_member', t);

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
end;
$$;

-- ---------------------------------------------------------------------------
-- Indici sulle chiavi esterne
-- ---------------------------------------------------------------------------
-- PostgreSQL non li crea da solo: senza, ogni cancellazione a cascata di un
-- progetto e ogni filtro per organizzazione richiede una scansione sequenziale.
create index if not exists blog_plans_project_idx on public.blog_plans (project_id, created_at desc);
create index if not exists blog_plans_org_idx on public.blog_plans (organization_id);

create index if not exists blog_articles_project_idx on public.blog_articles (project_id, created_at desc);
create index if not exists blog_articles_org_idx on public.blog_articles (organization_id);

create index if not exists courses_project_idx on public.courses (project_id, created_at desc);
create index if not exists courses_org_idx on public.courses (organization_id);

create index if not exists course_lessons_project_idx on public.course_lessons (project_id);
create index if not exists course_lessons_org_idx on public.course_lessons (organization_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260819160001_tool_logo.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- Logo dello strumento oggetto del progetto
--
-- Il logo si carica in fase di input, accanto alle fonti: è il primo dato
-- visivo del progetto e serve alla copertina e alle anteprime dei corsi.
--
-- Non è un riferimento visuale come gli altri — quelli dicono «questo è il
-- registro», questo dice «questo è lo strumento» — e va composto tale e quale,
-- non ridisegnato. Distinguerlo con un valore proprio evita di doverlo
-- riconoscere dal nome del file, che è un modo per sbagliare.
-- ---------------------------------------------------------------------------

alter type asset_kind add value if not exists 'logo';

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260820120001_project_volumes.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Configurazioni dei manuali contenuti in un unico progetto/collana.
create table if not exists public.project_volumes (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  volume_number   integer not null,
  title           text not null,
  subtitle        text,
  level           editorial_level not null default 'base',
  audience        text,
  scope           text,
  out_of_scope    text,
  target_pages    integer,
  status          project_status not null default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, volume_number),
  constraint project_volumes_number_positive check (volume_number > 0),
  constraint project_volumes_pages_range check (target_pages is null or target_pages between 8 and 2000),
  constraint project_volumes_title_length check (char_length(title) between 1 and 200)
);

create trigger project_volumes_set_updated_at
  before update on public.project_volumes
  for each row execute function public.set_updated_at();

alter table public.project_volumes enable row level security;
alter table public.project_volumes force row level security;

create policy project_volumes_select_member on public.project_volumes
  for select to authenticated using (public.is_org_member(organization_id));
create policy project_volumes_insert_member on public.project_volumes
  for insert to authenticated with check (public.is_org_member(organization_id));
create policy project_volumes_update_member on public.project_volumes
  for update to authenticated using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy project_volumes_delete_member on public.project_volumes
  for delete to authenticated using (public.is_org_member(organization_id));

create index project_volumes_project_idx on public.project_volumes (project_id, volume_number);
create index project_volumes_org_idx on public.project_volumes (organization_id);

-- Ogni progetto esistente parte con una configurazione, senza perdere dati.
insert into public.project_volumes (
  project_id, organization_id, volume_number, title, subtitle, level,
  audience, scope, out_of_scope, target_pages, status
)
select id, organization_id, 1, title, subtitle, level,
       audience, scope, out_of_scope, target_pages, status
  from public.projects
on conflict (project_id, volume_number) do nothing;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260821170001_epub_export.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- EPUB è un formato editoriale finale al pari di PDF e HTML.
alter type public.export_format add value if not exists 'epub';
notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260823090001_cover_front_style.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Controlli editoriali del fronte: due righe titolo e palette condivisa col libro.
alter table public.cover_projects
  add column if not exists title_line_1 text,
  add column if not exists title_line_2 text,
  add column if not exists front_description text,
  add column if not exists accent_color text,
  add column if not exists accent_color_secondary text,
  add column if not exists tool_name text;

alter table public.cover_projects
  drop constraint if exists cover_projects_accent_color_hex,
  drop constraint if exists cover_projects_accent_color_secondary_hex;

alter table public.cover_projects
  add constraint cover_projects_accent_color_hex
    check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint cover_projects_accent_color_secondary_hex
    check (accent_color_secondary is null or accent_color_secondary ~ '^#[0-9A-Fa-f]{6}$');

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260824090001_cover_composition.sql
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.cover_projects
  add column if not exists composition jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ▶ 20260827090001_editorial_quality_hardening.sql
-- ═══════════════════════════════════════════════════════════════════════════

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
