import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createUser, type TestDatabase } from './harness';

/**
 * Fondamenta delle collane (Fase 8).
 *
 * Le migration vengono applicate davvero su PostgreSQL: quello che segue
 * verifica i vincoli come li applicherà il database in produzione, non come li
 * descrive la documentazione.
 */

let ctx: TestDatabase;
let daniel: { userId: string; organizationId: string };
let estranea: { userId: string; organizationId: string };
let seriesId: string;
let projectId: string;

beforeAll(async () => {
  ctx = await createTestDatabase();

  daniel = await createUser(ctx.db, 'daniel@esempio.it', 'Daniel Meloni');
  estranea = await createUser(ctx.db, 'estranea@altrodominio.it', 'Utente Estranea');

  const collana = await ctx.db.query<{ id: string }>(
    `insert into public.series (organization_id, name, slug, curator, created_by)
     values ($1, 'Google Cloud in Pratica', 'google-cloud-in-pratica', 'Daniel Meloni', $2)
     returning id`,
    [daniel.organizationId, daniel.userId],
  );
  seriesId = collana.rows[0]!.id;

  const progetto = await ctx.db.query<{ id: string }>(
    `insert into public.projects (organization_id, slug, title, author, created_by)
     values ($1, 'dataform-in-pratica', 'Dataform in Pratica', 'Daniel Meloni', $2)
     returning id`,
    [daniel.organizationId, daniel.userId],
  );
  projectId = progetto.rows[0]!.id;
}, 180_000);

afterAll(async () => {
  await ctx?.close();
});

describe('schema delle collane', () => {
  it('crea le diciassette tabelle previste', async () => {
    const attese = [
      'cross_volume_references', 'series', 'series_assets', 'series_change_impacts',
      'series_change_proposals', 'series_consistency_issues', 'series_consistency_runs',
      'series_cover_templates', 'series_members', 'series_release_plans', 'series_rule_overrides',
      'series_rules', 'series_shared_content_versions', 'series_shared_contents',
      'series_style_versions', 'series_terms', 'series_volumes',
    ];

    const risultato = await ctx.db.query<{ tablename: string }>(
      `select tablename from pg_tables
        where schemaname = 'public'
          and (tablename like 'series%' or tablename = 'cross_volume_references')
        order by tablename`,
    );

    expect(risultato.rows.map((r) => r.tablename)).toEqual(attese);
  });

  it('applica ENABLE e FORCE row level security a tutte', async () => {
    const risultato = await ctx.db.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and (c.relname like 'series%' or c.relname = 'cross_volume_references')
          and (not c.relrowsecurity or not c.relforcerowsecurity)`,
    );

    expect(risultato.rows).toEqual([]);
  });

  it('non aggiunge series_id né volume_number a projects', async () => {
    // La fonte di verità è series_volumes: due percorsi verso la stessa verità
    // finirebbero per divergere. Vedi docs/series.md, sezione 4.
    const risultato = await ctx.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'projects'
          and column_name in ('series_id', 'volume_number')`,
    );

    expect(risultato.rows).toEqual([]);
  });

  it('registra i sei agenti di collana, nessuno dichiarato funzionante', async () => {
    const risultato = await ctx.db.query<{ key: string; implemented: boolean }>(
      `select key::text as key, implemented from public.agent_definitions
        where key::text like 'series%' or key::text = 'cross_volume_reference'
        order by key::text`,
    );

    expect(risultato.rows).toHaveLength(6);
    expect(risultato.rows.every((r) => r.implemented === false)).toBe(true);
  });
});

describe('vincoli sui volumi', () => {
  it('accetta un volume collegato a un progetto esistente', async () => {
    const volume = await ctx.db.query<{ id: string }>(
      `insert into public.series_volumes
         (series_id, organization_id, volume_number, title, status, project_id, created_by)
       values ($1, $2, 1, 'Dataform in Pratica', 'draft', $3, $4)
       returning id`,
      [seriesId, daniel.organizationId, projectId, daniel.userId],
    );
    expect(volume.rows).toHaveLength(1);
  });

  it('rifiuta due volumi con lo stesso numero nella collana', async () => {
    await expect(
      ctx.db.query(
        `insert into public.series_volumes (series_id, organization_id, volume_number, title)
         values ($1, $2, 1, 'Doppione')`,
        [seriesId, daniel.organizationId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('rifiuta lo stesso progetto in due volumi', async () => {
    await expect(
      ctx.db.query(
        `insert into public.series_volumes
           (series_id, organization_id, volume_number, title, project_id)
         values ($1, $2, 99, 'Altro volume', $3)`,
        [seriesId, daniel.organizationId, projectId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('ammette un volume pianificato senza progetto', async () => {
    // «Volume 4, previsto per l'autunno» è un elemento di piano prima che di
    // redazione: deve poter esistere senza progetto.
    const volume = await ctx.db.query<{ id: string }>(
      `insert into public.series_volumes (series_id, organization_id, volume_number, title, status)
       values ($1, $2, 4, 'Volume futuro', 'planned')
       returning id`,
      [seriesId, daniel.organizationId],
    );
    expect(volume.rows).toHaveLength(1);
  });

  it('esige una data per un volume dichiarato pubblicato', async () => {
    await expect(
      ctx.db.query(
        `insert into public.series_volumes
           (series_id, organization_id, volume_number, title, status)
         values ($1, $2, 90, 'Senza data', 'published')`,
        [seriesId, daniel.organizationId],
      ),
    ).rejects.toThrow(/published_has_date|check/i);
  });

  it('rifiuta un ISBN malformato', async () => {
    await expect(
      ctx.db.query(
        `insert into public.series_volumes
           (series_id, organization_id, volume_number, title, isbn)
         values ($1, $2, 91, 'ISBN errato', 'non-un-isbn')`,
        [seriesId, daniel.organizationId],
      ),
    ).rejects.toThrow(/isbn|check/i);
  });

  /** Una copia stampata esiste comunque: cancellarne il record non la elimina. */
  it('impedisce la cancellazione di un volume pubblicato', async () => {
    const pubblicato = await ctx.db.query<{ id: string }>(
      `insert into public.series_volumes
         (series_id, organization_id, volume_number, title, status, published_date)
       values ($1, $2, 2, 'BigQuery in Pratica', 'published', '2026-03-01')
       returning id`,
      [seriesId, daniel.organizationId],
    );

    await expect(
      ctx.db.query('delete from public.series_volumes where id = $1', [pubblicato.rows[0]!.id]),
    ).rejects.toThrow(/pubblicato/i);
  });
});

describe('ereditarietà delle regole', () => {
  let versioneStile: string;

  it('crea una versione di stile con le sue regole', async () => {
    const versione = await ctx.db.query<{ id: string }>(
      `insert into public.series_style_versions
         (series_id, organization_id, kind, version, summary, is_current)
       values ($1, $2, 'visual', 1, 'Identità visiva iniziale', true)
       returning id`,
      [seriesId, daniel.organizationId],
    );
    versioneStile = versione.rows[0]!.id;

    await ctx.db.query(
      `insert into public.series_rules (style_version_id, series_id, organization_id, scope, key, value, mode)
       values ($1, $2, $3, 'palette', 'colore-primario', '"#16233d"'::jsonb, 'inherited'),
              ($1, $2, $3, 'fonts', 'font-titoli', '"Georgia"'::jsonb, 'locked')`,
      [versioneStile, seriesId, daniel.organizationId],
    );

    const regole = await ctx.db.query('select id from public.series_rules where style_version_id = $1', [
      versioneStile,
    ]);
    expect(regole.rows).toHaveLength(2);
  });

  it('ammette una sola versione corrente per collana e tipo', async () => {
    await expect(
      ctx.db.query(
        `insert into public.series_style_versions
           (series_id, organization_id, kind, version, is_current)
         values ($1, $2, 'visual', 2, true)`,
        [seriesId, daniel.organizationId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('accetta una deroga motivata su una regola ereditabile', async () => {
    const volume = await ctx.db.query<{ id: string }>(
      'select id from public.series_volumes where series_id = $1 and volume_number = 4',
      [seriesId],
    );

    const deroga = await ctx.db.query<{ id: string }>(
      `insert into public.series_rule_overrides
         (volume_id, series_id, organization_id, scope, key, value, reason)
       values ($1, $2, $3, 'palette', 'colore-primario', '"#2f7d72"'::jsonb,
               'Il verde distingue questo volume dagli altri della collana.')
       returning id`,
      [volume.rows[0]!.id, seriesId, daniel.organizationId],
    );

    expect(deroga.rows).toHaveLength(1);
  });

  /** Una deroga non spiegata è indistinguibile da un errore. */
  it('rifiuta una deroga priva di motivazione', async () => {
    const volume = await ctx.db.query<{ id: string }>(
      'select id from public.series_volumes where series_id = $1 and volume_number = 4',
      [seriesId],
    );

    await expect(
      ctx.db.query(
        `insert into public.series_rule_overrides
           (volume_id, series_id, organization_id, scope, key, value, reason)
         values ($1, $2, $3, 'grid', 'colonne', '"12"'::jsonb, '   ')`,
        [volume.rows[0]!.id, seriesId, daniel.organizationId],
      ),
    ).rejects.toThrow(/reason|check/i);
  });

  /** Il rifiuto è esplicito: un fallimento silenzioso farebbe credere il contrario. */
  it('rifiuta una deroga su una regola bloccata', async () => {
    const volume = await ctx.db.query<{ id: string }>(
      'select id from public.series_volumes where series_id = $1 and volume_number = 4',
      [seriesId],
    );

    await expect(
      ctx.db.query(
        `insert into public.series_rule_overrides
           (volume_id, series_id, organization_id, scope, key, value, reason)
         values ($1, $2, $3, 'fonts', 'font-titoli', '"Helvetica"'::jsonb,
                 'Motivazione presente ma la regola e bloccata.')`,
        [volume.rows[0]!.id, seriesId, daniel.organizationId],
      ),
    ).rejects.toThrow(/bloccata/i);
  });

  it('rende immutabile una versione di stile pubblicata', async () => {
    const versione = await ctx.db.query<{ id: string }>(
      `insert into public.series_style_versions
         (series_id, organization_id, kind, version, summary, is_published, published_at)
       values ($1, $2, 'editorial', 1, 'Linea editoriale', true, now())
       returning id`,
      [seriesId, daniel.organizationId],
    );

    await expect(
      ctx.db.query('update public.series_style_versions set summary = $2 where id = $1', [
        versione.rows[0]!.id,
        'Riscritta',
      ]),
    ).rejects.toThrow(/immutabile/i);
  });
});

describe('riferimenti fra volumi', () => {
  it('registra una relazione fra due volumi', async () => {
    const volumi = await ctx.db.query<{ id: string; volume_number: number }>(
      'select id, volume_number from public.series_volumes where series_id = $1 order by volume_number',
      [seriesId],
    );

    const primo = volumi.rows.find((v) => v.volume_number === 1)!;
    const secondo = volumi.rows.find((v) => v.volume_number === 2)!;

    const riferimento = await ctx.db.query<{ id: string }>(
      `insert into public.cross_volume_references
         (series_id, organization_id, from_volume_id, to_volume_id, relation)
       values ($1, $2, $3, $4, 'requires')
       returning id`,
      [seriesId, daniel.organizationId, secondo.id, primo.id],
    );

    expect(riferimento.rows).toHaveLength(1);
  });

  it('rifiuta un volume che riferisce sé stesso', async () => {
    const volume = await ctx.db.query<{ id: string }>(
      'select id from public.series_volumes where series_id = $1 limit 1',
      [seriesId],
    );

    await expect(
      ctx.db.query(
        `insert into public.cross_volume_references
           (series_id, organization_id, from_volume_id, to_volume_id, relation)
         values ($1, $2, $3, $3, 'requires')`,
        [seriesId, daniel.organizationId, volume.rows[0]!.id],
      ),
    ).rejects.toThrow(/not_self|check/i);
  });
});

describe('isolamento fra organizzazioni', () => {
  it('il curatore vede la propria collana', async () => {
    const righe = await ctx.as(daniel.userId, async () =>
      ctx.db.query<{ name: string }>('select name from public.series'),
    );
    expect(righe.rows.map((r) => r.name)).toEqual(['Google Cloud in Pratica']);
  });

  it('un estraneo non vede collane, volumi, regole né deroghe', async () => {
    const risultati = await ctx.as(estranea.userId, async () => ({
      series: (await ctx.db.query('select * from public.series')).rows,
      volumes: (await ctx.db.query('select * from public.series_volumes')).rows,
      rules: (await ctx.db.query('select * from public.series_rules')).rows,
      overrides: (await ctx.db.query('select * from public.series_rule_overrides')).rows,
      terms: (await ctx.db.query('select * from public.series_terms')).rows,
      refs: (await ctx.db.query('select * from public.cross_volume_references')).rows,
    }));

    expect(risultati.series).toEqual([]);
    expect(risultati.volumes).toEqual([]);
    expect(risultati.rules).toEqual([]);
    expect(risultati.overrides).toEqual([]);
    expect(risultati.terms).toEqual([]);
    expect(risultati.refs).toEqual([]);
  });

  it('un estraneo non può creare una collana in un’organizzazione altrui', async () => {
    await expect(
      ctx.as(estranea.userId, async () =>
        ctx.db.query(
          `insert into public.series (organization_id, name, slug, created_by)
           values ($1, 'Collana intrusa', 'collana-intrusa', $2)`,
          [daniel.organizationId, estranea.userId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('un estraneo non può modificare un volume altrui', async () => {
    const risultato = await ctx.as(estranea.userId, async () =>
      ctx.db.query("update public.series_volumes set title = 'Dirottato' where volume_number = 1"),
    );
    expect(risultato.affectedRows ?? 0).toBe(0);
  });
});
