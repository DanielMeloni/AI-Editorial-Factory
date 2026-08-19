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
