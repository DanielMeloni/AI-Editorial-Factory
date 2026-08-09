-- =============================================================================
-- 09 · Row Level Security
-- -----------------------------------------------------------------------------
-- Regola generale: un utente vede e modifica soltanto i dati delle
-- organizzazioni di cui e' membro.
--
-- FORCE ROW LEVEL SECURITY applica le policy anche al proprietario della
-- tabella: senza di esso, un ruolo che possiede la tabella le ignorerebbe.
-- Il service role resta esente (bypassrls) ed e' confinato al server.
-- =============================================================================

-- Il ruolo anonimo non ha alcun accesso ai dati editoriali.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- ---------------------------------------------------------------------------
-- Abilitazione
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  protected_tables text[] := array[
    'profiles', 'organizations', 'organization_members',
    'projects', 'project_sources', 'source_files', 'source_chunks',
    'project_manifests', 'publication_parts', 'chapters', 'chapter_versions',
    'citations', 'style_guides',
    'agent_definitions', 'workflow_runs', 'agent_runs', 'verification_issues',
    'review_requests', 'review_comments',
    'visual_assets', 'cover_projects',
    'publication_outputs', 'exports', 'usage_events', 'audit_log'
  ];
begin
  foreach t in array protected_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: ognuno vede e modifica soltanto il proprio profilo
-- ---------------------------------------------------------------------------
create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create policy organizations_select_member on public.organizations
  for select to authenticated using (public.is_org_member(id));

create policy organizations_insert_self on public.organizations
  for insert to authenticated with check (created_by = auth.uid());

create policy organizations_update_admin on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::member_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::member_role[]));

create policy organizations_delete_owner on public.organizations
  for delete to authenticated
  using (public.has_org_role(id, array['owner']::member_role[]));

-- ---------------------------------------------------------------------------
-- organization_members
-- La lettura passa da is_org_member(), che e' SECURITY DEFINER: senza di essa
-- la policy interrogherebbe la tabella su cui e' definita, entrando in ricorsione.
-- ---------------------------------------------------------------------------
create policy organization_members_select on public.organization_members
  for select to authenticated using (public.is_org_member(organization_id));

create policy organization_members_write_admin on public.organization_members
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::member_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::member_role[]));

-- ---------------------------------------------------------------------------
-- agent_definitions: catalogo condiviso, in sola lettura per gli utenti
-- ---------------------------------------------------------------------------
create policy agent_definitions_select on public.agent_definitions
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Tabelle con organization_id: una policy uniforme per tutte
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  org_tables text[] := array[
    'projects', 'project_sources', 'source_files', 'source_chunks',
    'project_manifests', 'publication_parts', 'chapters', 'chapter_versions',
    'citations', 'style_guides',
    'workflow_runs', 'agent_runs', 'verification_issues',
    'review_requests', 'review_comments',
    'visual_assets', 'cover_projects',
    'publication_outputs', 'exports'
  ];
begin
  foreach t in array org_tables loop
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
-- usage_events e audit_log: lettura riservata, scrittura solo lato server
-- ---------------------------------------------------------------------------
create policy usage_events_select_member on public.usage_events
  for select to authenticated using (public.is_org_member(organization_id));

create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (
    organization_id is not null
    and public.has_org_role(organization_id, array['owner', 'admin']::member_role[])
  );

-- Nessuna policy di INSERT su usage_events e audit_log: con RLS attiva e
-- nessuna policy permissiva, la scrittura dal client e' negata. Solo il
-- service role, che ignora la RLS, puo' registrare consumi ed eventi.
