-- =============================================================================
-- 17 · Stato «proposta» per le fonti
-- -----------------------------------------------------------------------------
-- File a sé per necessità: PostgreSQL non consente di usare un valore di enum
-- nella stessa transazione in cui viene aggiunto con ALTER TYPE ... ADD VALUE.
-- Il valore entra qui; la migration 18 lo impiega.
--
-- La ricerca web propone; l'autore dispone. Una fonte trovata automaticamente
-- entra in biblioteca come `proposed` e non viene indicizzata: resta un
-- suggerimento finché qualcuno non la accetta.
-- =============================================================================

alter type reference_status add value if not exists 'proposed';
