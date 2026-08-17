-- =============================================================================
-- 18 · Fonti trovate sul web
-- -----------------------------------------------------------------------------
-- Riusare `reference_sources` invece di una tabella a parte è deliberato: una
-- fonte accettata non deve essere copiata da qualche parte, deve solo cambiare
-- stato. Meno passaggi, meno occasioni di divergenza.
--
-- Impiega lo stato `proposed` introdotto dalla migration 17.
-- =============================================================================

-- Come è entrata in biblioteca. Serve a distinguere ciò che l'autore ha scelto
-- da ciò che gli è stato proposto: la fiducia da accordare non è la stessa.
create type reference_added_by as enum ('manuale', 'ricerca_web');

alter table public.reference_sources
  add column added_by         reference_added_by not null default 'manuale',
  -- Perché questa fonte servirebbe a questo manuale. È ciò che il revisore
  -- legge per decidere: senza motivazione una proposta è solo un URL in più.
  add column rationale        text,
  -- L'interrogazione che l'ha fatta emergere: rende la proposta rintracciabile.
  add column discovery_query  text,
  add column web_kind         text,
  add column priority         integer,
  -- Che cosa ha risposto la pagina quando è stata aperta, e quando.
  add column http_status      integer,
  add column verified_at      timestamptz;

alter table public.reference_sources
  add constraint reference_sources_priority_range
    check (priority is null or priority between 1 and 3),
  -- Una proposta arriva sempre da una ricerca, e porta con sé il perché.
  add constraint reference_sources_proposal_coherent check (
    added_by = 'manuale' or (rationale is not null and discovery_query is not null)
  );

comment on column public.reference_sources.added_by is
  'manuale: aggiunta dall''autore. ricerca_web: proposta dalla ricerca automatica, da accettare.';

-- Le proposte in attesa sono l'unico sottoinsieme interrogato di continuo.
create index reference_sources_proposed_idx
  on public.reference_sources (project_id, priority, created_at desc)
  where status = 'proposed';
