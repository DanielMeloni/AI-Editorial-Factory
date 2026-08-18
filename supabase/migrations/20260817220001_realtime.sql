-- ---------------------------------------------------------------------------
-- Realtime: pubblicazione delle tabelle che alimentano lo stato dal vivo
-- ---------------------------------------------------------------------------
--
-- Senza questa pubblicazione il browser non riceve nulla e la pagina resta
-- ferma finché non la si ricarica a mano. Le policy di lettura già in vigore
-- continuano a valere: Realtime consegna un cambiamento soltanto a chi avrebbe
-- potuto leggerne la riga con una select. Pubblicare una tabella non allarga
-- quindi la visibilità, la estende nel tempo.
--
-- La replica identity resta quella predefinita, la chiave primaria: agli
-- ascoltatori serve la riga nuova, non quella vecchia, e `full` scriverebbe nel
-- WAL molto più del necessario.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

do $$
declare
  t text;
  tabelle text[] := array['workflow_runs', 'agent_runs', 'review_requests'];
begin
  foreach t in array tabelle loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
