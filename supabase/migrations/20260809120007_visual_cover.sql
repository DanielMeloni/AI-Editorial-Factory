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
