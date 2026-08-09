-- =============================================================================
-- 01 · Tipi enumerati
-- -----------------------------------------------------------------------------
-- Un vocabolario unico condiviso da database, dominio TypeScript e interfaccia.
-- I valori di run_status corrispondono a src/lib/workflow/status.ts.
-- =============================================================================

-- gen_random_uuid() e' nativo da PostgreSQL 13: nessuna estensione necessaria.

create type member_role as enum ('owner', 'admin', 'editor', 'viewer');

create type project_status as enum ('draft', 'importing', 'ready', 'archived');

create type source_status as enum (
  'uploaded',    -- archivio caricato, non ancora elaborato
  'extracting',  -- estrazione in corso
  'extracted',   -- estrazione completata senza errori
  'partial',     -- estratto con errori su singoli file
  'failed'       -- estrazione fallita
);

create type source_file_kind as enum (
  'markdown', 'pdf', 'image', 'code', 'data', 'config', 'script', 'archive', 'other'
);

create type part_kind as enum ('front_matter', 'part', 'appendix', 'back_matter');

create type chapter_status as enum ('draft', 'in_review', 'approved', 'published');

-- Origine di una versione di capitolo. 'original' e' immutabile per definizione.
create type version_origin as enum ('original', 'ai_proposal', 'human_edit', 'approved');

create type run_status as enum (
  'queued', 'running', 'awaiting_approval',
  'completed', 'completed_with_warnings', 'failed', 'cancelled'
);

create type agent_key as enum (
  'ingestion', 'source_auditor', 'curriculum', 'technical_verifier',
  'technical_writer', 'teaching', 'visual_art_director', 'technical_diagram',
  'illustration', 'cover', 'editorial_reviewer', 'publishing'
);

create type issue_kind as enum (
  'technical', 'editorial', 'source', 'curriculum', 'visual', 'structural'
);

create type issue_severity as enum ('info', 'low', 'medium', 'high', 'critical');

create type issue_status as enum ('open', 'acknowledged', 'resolved', 'dismissed');

create type review_status as enum ('pending', 'approved', 'rejected', 'changes_requested');

create type asset_kind as enum (
  'diagram', 'illustration', 'cover_front', 'cover_back', 'cover_spine', 'photo', 'other'
);

-- I diagrammi tecnici sono deterministici; solo 'ai' passa da un modello visuale.
create type asset_generator as enum ('mermaid', 'svg', 'ai', 'upload');

create type asset_status as enum ('draft', 'pending_approval', 'approved', 'rejected', 'superseded');

create type output_kind as enum ('manual', 'lesson', 'article');

create type export_format as enum ('markdown', 'html', 'pdf', 'json');

create type export_status as enum ('queued', 'running', 'ready', 'failed');

-- Formula per il calcolo del dorso: dipende dal fornitore di stampa.
create type spine_formula as enum ('mm_per_page', 'pages_per_inch', 'fixed');
