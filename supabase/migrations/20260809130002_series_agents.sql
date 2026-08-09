-- =============================================================================
-- 14 · Registrazione degli agenti di collana
-- -----------------------------------------------------------------------------
-- File separato per necessità: PostgreSQL non consente di usare un valore di
-- enum nella stessa transazione in cui viene aggiunto con ALTER TYPE ... ADD
-- VALUE. I valori sono introdotti dalla migration 13; qui vengono impiegati.
--
-- Tutti con implemented = false: l'architettura è predisposta, il comportamento
-- no. L'interfaccia li mostra disattivati, mai come funzionanti.
-- =============================================================================

insert into public.agent_definitions (key, name, description, is_visual, implemented, default_model)
values
  ('series_architect', 'Series Architect Agent',
   'Progetta struttura e roadmap di una collana editoriale.',
   false, false, null),

  ('series_curriculum', 'Series Curriculum Agent',
   'Verifica progressione della difficolta'', prerequisiti fra volumi, concetti usati prima di essere spiegati, lacune e sovrapposizioni.',
   false, false, null),

  ('series_consistency', 'Series Consistency Agent',
   'Controlla coerenza editoriale, terminologica, visiva, didattica e tecnica fra i volumi, distinguendo le differenze autorizzate da quelle non autorizzate.',
   false, false, null),

  ('series_visual_director', 'Series Visual Director',
   'Governa l''identita'' visiva condivisa e le differenze controllate fra volumi.',
   true, false, null),

  ('cross_volume_reference', 'Cross-Volume Reference Agent',
   'Gestisce riferimenti e collegamenti fra volumi, segnalando quando la destinazione cambia.',
   false, false, null),

  ('series_publishing', 'Series Publishing Agent',
   'Produce catalogo, schede dei volumi e materiali promozionali dell''intera collana.',
   false, false, null)
on conflict (key) do update
  set name        = excluded.name,
      description = excluded.description,
      is_visual   = excluded.is_visual,
      updated_at  = now();
