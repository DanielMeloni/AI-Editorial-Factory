-- =============================================================================
-- 12 · Catalogo dei dodici agenti
-- -----------------------------------------------------------------------------
-- `implemented` distingue cio' che funziona da cio' che e' soltanto previsto
-- dall'architettura. L'interfaccia legge questo campo: un agente non
-- implementato appare disattivato con la dicitura "Disponibile prossimamente",
-- mai come funzionante.
--
-- Alla Fase 2 nessun agente e' ancora operativo: l'ingestione e' deterministica
-- e non passa da un modello. I flag verranno aggiornati dalla Fase 3.
-- =============================================================================

insert into public.agent_definitions (key, name, description, is_visual, implemented, default_model)
values
  ('ingestion', 'Ingestion Agent',
   'Classifica sorgenti, capitoli, codice e asset, e ricostruisce la struttura dell''opera.',
   false, false, null),

  ('source_auditor', 'Source Auditor',
   'Verifica completezza, attendibilita'' e aggiornamento dei riferimenti citati.',
   false, false, null),

  ('curriculum', 'Curriculum Agent',
   'Controlla ordine didattico, prerequisiti, obiettivi ed esercizi.',
   false, false, null),

  ('technical_verifier', 'Technical Verifier',
   'Analizza SQL, SQLX, JavaScript, configurazioni Dataform e affermazioni tecniche.',
   false, false, null),

  ('technical_writer', 'Technical Writer',
   'Propone revisioni del testo mantenendo lo stile dell''autore.',
   false, false, null),

  ('teaching', 'Teaching Agent',
   'Migliora esempi, analogie, riepiloghi, esercizi e quiz.',
   false, false, null),

  ('visual_art_director', 'Visual Art Director',
   'Definisce stile, palette, tipi di figura e coerenza visiva della collana.',
   true, false, null),

  ('technical_diagram', 'Technical Diagram Agent',
   'Produce Mermaid o SVG deterministici per DAG, pipeline e architetture.',
   true, false, null),

  ('illustration', 'Illustration Agent',
   'Genera illustrazioni concettuali tramite un provider visuale.',
   true, false, null),

  ('cover', 'Cover Agent',
   'Progetta fronte, quarta di copertina e dorso.',
   true, false, null),

  ('editorial_reviewer', 'Editorial Reviewer',
   'Controlla stile, terminologia, duplicazioni e coerenza complessiva.',
   false, false, null),

  ('publishing', 'Publishing Agent',
   'Produce Markdown, HTML, PDF, lezione e articolo dalla versione approvata.',
   false, false, null)
on conflict (key) do update
  set name        = excluded.name,
      description = excluded.description,
      is_visual   = excluded.is_visual,
      updated_at  = now();
