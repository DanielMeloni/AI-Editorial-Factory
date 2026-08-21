import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createUser, type TestDatabase } from './harness';

let ctx: TestDatabase;

beforeAll(async () => {
  ctx = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await ctx?.close();
});

describe('applicazione delle migration', () => {
  it('crea tutte le tabelle previste', async () => {
    const expected = [
      // Nucleo editoriale (migration 01-12)
      'agent_definitions',
      'agent_runs',
      'audit_log',
      'chapter_versions',
      'chapters',
      'citations',
      'cover_projects',
      'exports',
      'organization_members',
      'organizations',
      'profiles',
      'project_manifests',
      'project_sources',
      'project_volumes',
      'projects',
      'publication_outputs',
      'publication_parts',
      'review_comments',
      'review_requests',
      'source_chunks',
      'source_files',
      'style_guides',
      'usage_events',
      'verification_issues',
      'visual_assets',
      'workflow_runs',
      // Collane editoriali (migration 13), in attesa della Fase 8
      'cross_volume_references',
      'series',
      'series_assets',
      'series_change_impacts',
      'series_change_proposals',
      'series_consistency_issues',
      'series_consistency_runs',
      'series_cover_templates',
      'series_members',
      'series_release_plans',
      'series_rule_overrides',
      'series_rules',
      'series_shared_content_versions',
      'series_shared_contents',
      'series_style_versions',
      'series_terms',
      'series_volumes',
      // Ricerca automatica delle fonti (migration 15-16)
      'source_suggestions',
      'reference_sources',
      'reference_chunks',
      // Derivazioni editoriali: corsi e blog
      'courses',
      'course_lessons',
      'blog_plans',
      'blog_articles',
    ].sort();

    const result = await ctx.db.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(result.rows.map((r) => r.tablename)).toEqual(expected);
  });

  it('attiva ENABLE e FORCE row level security su ogni tabella esposta', async () => {
    const result = await ctx.db.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname`,
    );

    const senzaRls = result.rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity);
    expect(senzaRls.map((r) => r.relname)).toEqual([]);
  });

  it('registra diciotto agenti, nessuno dichiarato funzionante', async () => {
    // Dodici sul singolo capitolo (migration 12) più sei di collana
    // (migration 14, fondamenta della Fase 8).
    const result = await ctx.db.query<{ count: string; implemented: string }>(
      'select count(*)::text as count, count(*) filter (where implemented)::text as implemented from public.agent_definitions',
    );
    expect(result.rows[0]!.count).toBe('18');
    expect(result.rows[0]!.implemented).toBe('0');
  });

  it('crea i tre bucket privati', async () => {
    const result = await ctx.db.query<{ id: string; public: boolean }>(
      'select id, public from storage.buckets order by id',
    );
    expect(result.rows.map((r) => r.id)).toEqual([
      'generated-assets',
      'project-sources',
      'publication-exports',
    ]);
    expect(result.rows.every((r) => r.public === false)).toBe(true);
  });

  it('indicizza ogni chiave esterna, tranne le colonne che indicano un autore', async () => {
    // Una FK senza indice rende lenta ogni cancellazione a cascata.
    // Le colonne "autore" referenziano auth.users con ON DELETE SET NULL:
    // scritte sempre, interrogate quasi mai. Indicizzarle non conviene.
    const result = await ctx.db.query<{ tbl: string; col: string }>(
      `select cl.relname as tbl, att.attname as col
         from pg_constraint con
         join pg_class cl on cl.oid = con.conrelid
         join pg_namespace n on n.oid = cl.relnamespace
         join lateral unnest(con.conkey) as k(attnum) on true
         join pg_attribute att on att.attrelid = cl.oid and att.attnum = k.attnum
        where con.contype = 'f' and n.nspname = 'public'
          and array_length(con.conkey, 1) = 1
          and att.attname not in (
            'created_by', 'approved_by', 'requested_by', 'decided_by',
            'resolved_by', 'uploaded_by', 'generated_by', 'started_by',
            'author_id', 'actor_id', 'owner_id', 'user_id', 'id'
          )
          and not exists (
            select 1 from pg_index i
             where i.indrelid = cl.oid and i.indkey[0] = att.attnum
          )
        order by cl.relname, att.attname`,
    );
    expect(result.rows).toEqual([]);
  });
});

describe('provisioning alla registrazione', () => {
  it('crea profilo, organizzazione personale e appartenenza come proprietario', async () => {
    const { userId, organizationId } = await createUser(
      ctx.db,
      'daniel@esempio.it',
      'Daniel Meloni',
    );

    const profile = await ctx.db.query<{ full_name: string }>(
      'select full_name from public.profiles where id = $1',
      [userId],
    );
    expect(profile.rows[0]!.full_name).toBe('Daniel Meloni');

    const org = await ctx.db.query<{ slug: string; is_personal: boolean }>(
      'select slug, is_personal from public.organizations where id = $1',
      [organizationId],
    );
    expect(org.rows[0]!.slug).toBe('daniel-meloni');
    expect(org.rows[0]!.is_personal).toBe(true);

    const member = await ctx.db.query<{ role: string }>(
      'select role from public.organization_members where user_id = $1',
      [userId],
    );
    expect(member.rows[0]!.role).toBe('owner');
  });

  it('rende univoco lo slug in caso di omonimia', async () => {
    const a = await createUser(ctx.db, 'omonimo1@esempio.it', 'Mario Rossi');
    const b = await createUser(ctx.db, 'omonimo2@esempio.it', 'Mario Rossi');

    const slugs = await ctx.db.query<{ slug: string }>(
      'select slug from public.organizations where id = any($1) order by slug',
      [[a.organizationId, b.organizationId]],
    );
    expect(slugs.rows.map((r) => r.slug)).toEqual(['mario-rossi', 'mario-rossi-1']);
  });
});
