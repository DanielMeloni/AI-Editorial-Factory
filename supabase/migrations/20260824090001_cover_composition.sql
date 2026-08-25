alter table public.cover_projects
  add column if not exists composition jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
