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
