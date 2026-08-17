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
