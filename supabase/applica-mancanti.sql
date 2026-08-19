-- =============================================================================
-- Da applicare a questo progetto Supabase: le due migration mancanti
-- -----------------------------------------------------------------------------
-- Generato dalla diagnosi del 19 agosto 2026. Il database risultava allineato
-- fino a `20260817230001_editorial_direction`; mancavano soltanto le tabelle di
-- corsi e blog e la Row Level Security che le protegge.
--
-- Incollare INTERO nell'SQL Editor di Supabase ed eseguire una volta sola.
-- L'ordine conta: la seconda parte accende la RLS sulle tabelle create dalla
-- prima, e da sola fallirebbe.
--
-- Dopo l'esecuzione, rilanciare `supabase/diagnosi-migration.sql`: la seconda
-- query — le tabelle esposte senza RLS — deve restituire zero righe.
-- =============================================================================

-- ==========================================================================
-- ▶ 20260818090001_blog_courses.sql
-- ==========================================================================

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

-- ==========================================================================
-- ▶ 20260819100001_blog_courses_rls.sql
-- ==========================================================================

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

