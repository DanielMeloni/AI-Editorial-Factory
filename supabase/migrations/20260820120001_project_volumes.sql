-- Configurazioni dei manuali contenuti in un unico progetto/collana.
create table if not exists public.project_volumes (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  volume_number   integer not null,
  title           text not null,
  subtitle        text,
  level           editorial_level not null default 'base',
  audience        text,
  scope           text,
  out_of_scope    text,
  target_pages    integer,
  status          project_status not null default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, volume_number),
  constraint project_volumes_number_positive check (volume_number > 0),
  constraint project_volumes_pages_range check (target_pages is null or target_pages between 8 and 2000),
  constraint project_volumes_title_length check (char_length(title) between 1 and 200)
);

create trigger project_volumes_set_updated_at
  before update on public.project_volumes
  for each row execute function public.set_updated_at();

alter table public.project_volumes enable row level security;
alter table public.project_volumes force row level security;

create policy project_volumes_select_member on public.project_volumes
  for select to authenticated using (public.is_org_member(organization_id));
create policy project_volumes_insert_member on public.project_volumes
  for insert to authenticated with check (public.is_org_member(organization_id));
create policy project_volumes_update_member on public.project_volumes
  for update to authenticated using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy project_volumes_delete_member on public.project_volumes
  for delete to authenticated using (public.is_org_member(organization_id));

create index project_volumes_project_idx on public.project_volumes (project_id, volume_number);
create index project_volumes_org_idx on public.project_volumes (organization_id);

-- Ogni progetto esistente parte con una configurazione, senza perdere dati.
insert into public.project_volumes (
  project_id, organization_id, volume_number, title, subtitle, level,
  audience, scope, out_of_scope, target_pages, status
)
select id, organization_id, 1, title, subtitle, level,
       audience, scope, out_of_scope, target_pages, status
  from public.projects
on conflict (project_id, volume_number) do nothing;

notify pgrst, 'reload schema';
