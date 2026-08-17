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
