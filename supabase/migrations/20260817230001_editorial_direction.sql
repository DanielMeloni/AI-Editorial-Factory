-- ---------------------------------------------------------------------------
-- Direzione editoriale del progetto: livello, tono, registro
-- ---------------------------------------------------------------------------
--
-- Tre volumi sullo stesso argomento non si distinguono per il titolo: si
-- distinguono per a chi parlano e come. Questi valori entrano nei prompt del
-- Curriculum Agent e del Chapter Drafter, e sono la sola ragione per cui
-- «Dataform base» e «Dataform avanzato» non producono lo stesso libro.
--
-- Sono liste chiuse di proposito. Un tono scritto a mano ogni volta farebbe
-- divergere i volumi per come sono stati descritti invece che per il livello,
-- e il confronto fra loro non direbbe più nulla. Le sfumature che la lista non
-- copre vanno in `style_notes`, dove si vedono e si possono correggere.
--
-- La migrazione è riscrivibile: in questo progetto capita di applicarla
-- incollandola nell'editor SQL, e una seconda esecuzione non deve fallire.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'editorial_level') then
    create type editorial_level as enum ('base', 'intermediate', 'advanced');
  end if;
end;
$$;

alter table public.projects
  add column if not exists level       editorial_level not null default 'base',
  add column if not exists tone        text not null default 'didattico',
  add column if not exists register    text not null default 'tecnico_operativo',
  add column if not exists style_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_tone_allowed'
  ) then
    alter table public.projects
      add constraint projects_tone_allowed
        check (tone in ('didattico', 'professionale', 'discorsivo', 'conciso'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'projects_register_allowed'
  ) then
    alter table public.projects
      add constraint projects_register_allowed
        check (register in ('divulgativo', 'tecnico_operativo', 'rigoroso_formale'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'projects_style_notes_length'
  ) then
    alter table public.projects
      add constraint projects_style_notes_length
        check (style_notes is null or char_length(style_notes) <= 2000);
  end if;
end;
$$;
