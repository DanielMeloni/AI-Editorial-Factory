-- Controlli editoriali del fronte: due righe titolo e palette condivisa col libro.
alter table public.cover_projects
  add column if not exists title_line_1 text,
  add column if not exists title_line_2 text,
  add column if not exists front_description text,
  add column if not exists accent_color text,
  add column if not exists accent_color_secondary text,
  add column if not exists tool_name text;

alter table public.cover_projects
  add constraint cover_projects_accent_color_hex
    check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint cover_projects_accent_color_secondary_hex
    check (accent_color_secondary is null or accent_color_secondary ~ '^#[0-9A-Fa-f]{6}$');

notify pgrst, 'reload schema';
