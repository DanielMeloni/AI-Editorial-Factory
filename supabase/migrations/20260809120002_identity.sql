-- =============================================================================
-- 02 · Identita': profili, organizzazioni, appartenenze
-- -----------------------------------------------------------------------------
-- Ogni dato editoriale appartiene a un'organizzazione, anche quando esiste un
-- solo proprietario. E' la chiave di isolamento su cui poggia tutta la RLS.
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_full_name_length check (char_length(full_name) <= 120)
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  is_personal boolean not null default false,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint organizations_name_length check (char_length(name) between 1 and 120),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------
create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            member_role not null default 'editor',
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Funzioni di appartenenza
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER e' indispensabile: una policy su organization_members che
-- interroghi organization_members entrerebbe in ricorsione infinita.
-- search_path fissato per impedire il dirottamento dei nomi.
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(target_org uuid, allowed member_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.role = any (allowed)
  );
$$;

revoke execute on function public.is_org_member(uuid) from public;
revoke execute on function public.has_org_role(uuid, member_role[]) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, member_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Provisioning automatico alla registrazione
-- -----------------------------------------------------------------------------
-- Crea profilo, organizzazione personale e appartenenza come proprietario.
-- Senza questo trigger un utente appena registrato non apparterrebbe ad alcuna
-- organizzazione e non potrebbe creare progetti.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  display_name text;
  base_slug    text;
  final_slug   text;
  suffix       integer := 0;
  new_org_id   uuid;
begin
  display_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));

  insert into public.profiles (id, full_name)
  values (new.id, left(display_name, 120))
  on conflict (id) do nothing;

  base_slug := regexp_replace(lower(display_name), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then
    base_slug := 'redazione';
  end if;
  base_slug := left(base_slug, 40);

  final_slug := base_slug;
  while exists (select 1 from public.organizations o where o.slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix::text;
  end loop;

  insert into public.organizations (name, slug, is_personal, created_by)
  values (left(display_name, 120), final_slug, true, new.id)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
