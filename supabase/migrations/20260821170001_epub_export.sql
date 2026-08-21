-- EPUB è un formato editoriale finale al pari di PDF e HTML.
alter type public.export_format add value if not exists 'epub';
notify pgrst, 'reload schema';
