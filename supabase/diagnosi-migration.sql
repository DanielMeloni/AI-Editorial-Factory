-- =============================================================================
-- A che punto è questo database
-- -----------------------------------------------------------------------------
-- Da incollare nell'SQL Editor di Supabase. Non modifica nulla: dice soltanto
-- quali migration risultano già applicate e quali no, guardando le tabelle che
-- ciascuna crea.
--
-- Serve quando `supabase db push` non è stato usato e le migration sono state
-- incollate a mano: in quel caso nessuno tiene il conto, e l'unico modo di
-- sapere dove si è arrivati è chiederlo allo schema.
-- =============================================================================

with attese(migration, tabella) as (
  values
    ('…120002_identity',          'organizations'),
    ('…120003_projects_sources',  'project_sources'),
    ('…120004_editorial',         'chapters'),
    ('…120005_agents_workflows',  'workflow_runs'),
    ('…120006_reviews',           'review_requests'),
    ('…120007_visual_cover',      'visual_assets'),
    ('…120008_publication',       'publication_outputs'),
    ('…130001_series',            'series'),
    ('…140001_source_research',   'source_suggestions'),
    ('…140002_reference_library', 'reference_sources'),
    ('…140004_web_discovery',     'reference_sources'),
    -- Questa migration non crea tabelle: aggiunge colonne a `projects`, che
    -- esiste da sempre. Controllarne l'esistenza non proverebbe nulla, e viene
    -- quindi verificata a parte, più sotto.
    ('…090001_blog_courses',      'courses'),
    ('…090001_blog_courses',      'blog_articles')
)
select
  migration,
  tabella,
  case when to_regclass('public.' || tabella) is null
       then 'MANCA — migration non applicata'
       else 'presente'
  end as stato
from attese
order by migration, tabella;

-- ---------------------------------------------------------------------------
-- Migration che non creano tabelle
-- ---------------------------------------------------------------------------
-- Vanno verificate da ciò che aggiungono, non dall'esistenza di una tabella.
select
  case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'projects'
            and column_name = 'style_notes'
       ) then 'presente' else 'MANCA — 20260817230001_editorial_direction' end
  as editorial_direction,
  case when exists (
         select 1 from pg_publication where pubname = 'supabase_realtime'
       ) then 'presente' else 'MANCA — 20260817220001_realtime' end
  as realtime;

-- ---------------------------------------------------------------------------
-- Tabelle esposte senza Row Level Security attiva
-- ---------------------------------------------------------------------------
-- Deve restituire zero righe. Una riga qui significa che i dati di quella
-- tabella sono leggibili fra organizzazioni diverse, anche se le policy
-- esistono: con la RLS spenta una policy non filtra nulla.
select c.relname as tabella_senza_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and (not c.relrowsecurity or not c.relforcerowsecurity)
 order by c.relname;
