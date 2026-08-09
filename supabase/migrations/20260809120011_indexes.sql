-- =============================================================================
-- 11 · Indici
-- -----------------------------------------------------------------------------
-- PostgreSQL non indicizza automaticamente le foreign key: senza questi indici
-- ogni cancellazione a cascata e ogni filtro per organizzazione richiederebbe
-- una scansione sequenziale.
-- =============================================================================

-- Identita'
create index organization_members_user_idx on public.organization_members (user_id);
create index organizations_created_by_idx on public.organizations (created_by);

-- Progetti e sorgenti
create index projects_org_idx on public.projects (organization_id, updated_at desc);
create index projects_created_by_idx on public.projects (created_by);

create index project_sources_project_idx on public.project_sources (project_id, created_at desc);
create index project_sources_org_idx on public.project_sources (organization_id);
create index project_sources_status_idx on public.project_sources (status) where status <> 'extracted';

create index source_files_source_idx on public.source_files (source_id);
create index source_files_project_kind_idx on public.source_files (project_id, kind);
create index source_files_org_idx on public.source_files (organization_id);
-- Individuazione dei duplicati: stesso contenuto in percorsi diversi.
create index source_files_sha256_idx on public.source_files (project_id, sha256);

create index source_chunks_file_idx on public.source_chunks (source_file_id, chunk_index);
create index source_chunks_project_idx on public.source_chunks (project_id);

-- Struttura editoriale
create index project_manifests_project_idx on public.project_manifests (project_id, version desc);
create index publication_parts_project_idx on public.publication_parts (project_id, order_index);
create index chapters_project_order_idx on public.chapters (project_id, order_index);
create index chapters_part_idx on public.chapters (part_id);
create index chapters_org_idx on public.chapters (organization_id);
create index chapters_source_file_idx on public.chapters (source_file_id);
create index chapters_current_version_idx on public.chapters (current_version_id);

create index chapter_versions_chapter_idx on public.chapter_versions (chapter_id, version_no desc);
create index chapter_versions_project_idx on public.chapter_versions (project_id);
create index chapter_versions_workflow_idx on public.chapter_versions (workflow_run_id);
create index chapter_versions_approved_idx on public.chapter_versions (chapter_id) where is_approved;

create index citations_chapter_idx on public.citations (chapter_id);
create index citations_project_idx on public.citations (project_id);
create index style_guides_org_idx on public.style_guides (organization_id);
create index style_guides_project_idx on public.style_guides (project_id);

-- Agenti e workflow
create index workflow_runs_project_idx on public.workflow_runs (project_id, created_at desc);
create index workflow_runs_chapter_idx on public.workflow_runs (chapter_id);
create index workflow_runs_org_idx on public.workflow_runs (organization_id);
-- Pannello "workflow attivi" della dashboard.
create index workflow_runs_active_idx on public.workflow_runs (organization_id, status)
  where status in ('queued', 'running', 'awaiting_approval');
create index workflow_runs_external_idx on public.workflow_runs (external_run_id);

create index agent_runs_workflow_idx on public.agent_runs (workflow_run_id, started_at);
create index agent_runs_project_idx on public.agent_runs (project_id, started_at desc);
create index agent_runs_org_idx on public.agent_runs (organization_id);
create index agent_runs_agent_idx on public.agent_runs (agent_key, status);
-- Riuso di un risultato gia' calcolato per lo stesso input.
create index agent_runs_input_hash_idx on public.agent_runs (agent_key, input_hash);

create index verification_issues_chapter_idx on public.verification_issues (chapter_id, severity);
create index verification_issues_project_idx on public.verification_issues (project_id);
create index verification_issues_open_idx on public.verification_issues (organization_id)
  where status = 'open';

-- Revisione
create index review_requests_chapter_idx on public.review_requests (chapter_id, requested_at desc);
create index review_requests_project_idx on public.review_requests (project_id);
create index review_requests_pending_idx on public.review_requests (organization_id)
  where status = 'pending';
create index review_comments_request_idx on public.review_comments (review_request_id, created_at);
create index review_comments_project_idx on public.review_comments (project_id);

-- Visual e copertine
create index visual_assets_project_idx on public.visual_assets (project_id, created_at desc);
create index visual_assets_chapter_idx on public.visual_assets (chapter_id);
create index visual_assets_org_idx on public.visual_assets (organization_id);
create index visual_assets_pending_idx on public.visual_assets (organization_id)
  where status = 'pending_approval';
create index visual_assets_parent_idx on public.visual_assets (parent_asset_id);
create index cover_projects_project_idx on public.cover_projects (project_id);

-- Pubblicazione e consumo
create index publication_outputs_chapter_idx on public.publication_outputs (chapter_id, kind);
create index publication_outputs_project_idx on public.publication_outputs (project_id, created_at desc);
create index exports_project_idx on public.exports (project_id, requested_at desc);
create index exports_org_idx on public.exports (organization_id);
create index exports_chapter_idx on public.exports (chapter_id);
create index usage_events_org_idx on public.usage_events (organization_id, occurred_at desc);
create index usage_events_agent_run_idx on public.usage_events (agent_run_id);
create index audit_log_org_idx on public.audit_log (organization_id, occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id);

-- ---------------------------------------------------------------------------
-- Copertura completa delle chiavi esterne
-- -----------------------------------------------------------------------------
-- Regola adottata: ogni FK a colonna singola ha un indice che la usa come
-- prima colonna, con una sola eccezione motivata — le colonne che indicano
-- l'autore di un'azione (created_by, approved_by, requested_by, decided_by,
-- resolved_by, uploaded_by, generated_by, started_by, actor_id) referenziano
-- auth.users con ON DELETE SET NULL. Sono scritte spessissimo e interrogate
-- quasi mai: indicizzarle costerebbe piu' di quanto renda.
-- Il test tests/db/schema.test.ts verifica questa regola.
-- ---------------------------------------------------------------------------
create index agent_runs_chapter_idx on public.agent_runs (chapter_id);
create index chapter_versions_org_idx on public.chapter_versions (organization_id);
create index chapter_versions_agent_run_idx on public.chapter_versions (agent_run_id);
create index chapter_versions_parent_idx on public.chapter_versions (parent_version_id);
create index citations_org_idx on public.citations (organization_id);
create index citations_version_idx on public.citations (chapter_version_id);
create index cover_projects_org_idx on public.cover_projects (organization_id);
create index cover_projects_front_asset_idx on public.cover_projects (front_asset_id);
create index cover_projects_back_asset_idx on public.cover_projects (back_asset_id);
create index cover_projects_spine_asset_idx on public.cover_projects (spine_asset_id);
create index cover_projects_series_logo_idx on public.cover_projects (series_logo_asset_id);
create index exports_output_idx on public.exports (publication_output_id);
create index project_manifests_org_idx on public.project_manifests (organization_id);
create index project_manifests_source_idx on public.project_manifests (source_id);
create index publication_outputs_org_idx on public.publication_outputs (organization_id);
create index publication_outputs_version_idx on public.publication_outputs (chapter_version_id);
create index publication_outputs_workflow_idx on public.publication_outputs (workflow_run_id);
create index publication_parts_org_idx on public.publication_parts (organization_id);
create index publication_parts_manifest_idx on public.publication_parts (manifest_id);
create index review_comments_org_idx on public.review_comments (organization_id);
create index review_requests_workflow_idx on public.review_requests (workflow_run_id);
create index review_requests_base_version_idx on public.review_requests (base_version_id);
create index review_requests_proposed_version_idx on public.review_requests (proposed_version_id);
create index source_chunks_org_idx on public.source_chunks (organization_id);
create index usage_events_project_idx on public.usage_events (project_id);
create index verification_issues_agent_run_idx on public.verification_issues (agent_run_id);
create index verification_issues_workflow_idx on public.verification_issues (workflow_run_id);
create index visual_assets_agent_run_idx on public.visual_assets (agent_run_id);
