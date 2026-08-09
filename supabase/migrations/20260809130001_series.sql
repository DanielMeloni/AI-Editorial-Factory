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
