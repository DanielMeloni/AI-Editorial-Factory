-- =============================================================================
-- 10 · Bucket di storage privati e relative policy
-- -----------------------------------------------------------------------------
-- Nessun bucket e' pubblico: ZIP sorgenti, PDF e asset generati sono
-- raggiungibili solo tramite URL firmati a scadenza, emessi dal server dopo
-- aver verificato l'appartenenza all'organizzazione.
--
-- Convenzione di percorso, identica nei tre bucket:
--     {organization_id}/{project_id}/...
-- Il primo segmento e' quindi sempre l'organizzazione: le policy lo usano per
-- decidere, senza dover interrogare altre tabelle.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'project-sources',
    'project-sources',
    false,
    1073741824,  -- 1 GiB
    array['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
  ),
  (
    'generated-assets',
    'generated-assets',
    false,
    52428800,    -- 50 MiB
    array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
  ),
  (
    'publication-exports',
    'publication-exports',
    false,
    536870912,   -- 512 MiB
    array['application/pdf', 'text/markdown', 'text/html', 'application/json', 'application/zip']
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Estrae l'organizzazione dal primo segmento del percorso dell'oggetto.
-- ---------------------------------------------------------------------------
create or replace function public.storage_object_org(object_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  first_segment text;
begin
  first_segment := split_part(object_name, '/', 1);
  if first_segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return first_segment::uuid;
exception
  when others then
    return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Policy sugli oggetti: solo i membri dell'organizzazione indicata dal percorso.
-- ---------------------------------------------------------------------------
do $$
declare
  b text;
  buckets text[] := array['project-sources', 'generated-assets', 'publication-exports'];
begin
  foreach b in array buckets loop
    execute format($p$
      create policy %I on storage.objects
        for select to authenticated
        using (
          bucket_id = %L
          and public.storage_object_org(name) is not null
          and public.is_org_member(public.storage_object_org(name))
        )
    $p$, b || '_select_member', b);

    execute format($p$
      create policy %I on storage.objects
        for insert to authenticated
        with check (
          bucket_id = %L
          and public.storage_object_org(name) is not null
          and public.is_org_member(public.storage_object_org(name))
        )
    $p$, b || '_insert_member', b);

    execute format($p$
      create policy %I on storage.objects
        for update to authenticated
        using (
          bucket_id = %L
          and public.storage_object_org(name) is not null
          and public.is_org_member(public.storage_object_org(name))
        )
    $p$, b || '_update_member', b);

    execute format($p$
      create policy %I on storage.objects
        for delete to authenticated
        using (
          bucket_id = %L
          and public.storage_object_org(name) is not null
          and public.is_org_member(public.storage_object_org(name))
        )
    $p$, b || '_delete_member', b);
  end loop;
end;
$$;
