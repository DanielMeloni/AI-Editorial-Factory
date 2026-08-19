-- ---------------------------------------------------------------------------
-- Brief del progetto: forma dell'opera, dimensione, ambito
-- ---------------------------------------------------------------------------
--
-- La direzione editoriale dice **come** si scrive; il brief dice **che cosa si
-- sta costruendo**. Senza, il Curriculum Agent conosce il titolo e le fonti e
-- deve indovinare il resto: una guida rapida di cento pagine e il primo volume
-- di una collana partono dallo stesso materiale e producono indici opposti.
--
-- «Fuori ambito» esiste per una ragione precisa: dire cosa un'opera non tratta
-- è spesso più efficace che elencare cosa tratta, e su un manuale tecnico è
-- l'unico modo per impedire che l'indice si allarghi fino a diventare
-- inutilizzabile.
--
-- Migrazione riscrivibile: in questo progetto capita di applicarla incollandola
-- nell'editor SQL.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'work_shape') then
    create type work_shape as enum ('volume_singolo', 'collana', 'guida_rapida');
  end if;
end;
$$;

alter table public.projects
  add column if not exists work_shape   work_shape not null default 'volume_singolo',
  -- Nullo significa «nessun vincolo di lunghezza», non «zero pagine».
  add column if not exists target_pages integer,
  add column if not exists scope        text,
  add column if not exists out_of_scope text,
  add column if not exists audience     text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_target_pages_range') then
    alter table public.projects
      add constraint projects_target_pages_range
        check (target_pages is null or target_pages between 8 and 2000);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'projects_brief_length') then
    alter table public.projects
      add constraint projects_brief_length check (
        (scope is null or char_length(scope) <= 3000)
        and (out_of_scope is null or char_length(out_of_scope) <= 2000)
        and (audience is null or char_length(audience) <= 1000)
      );
  end if;
end;
$$;
