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
