import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createUser, type TestDatabase } from './harness';

/**
 * Test di isolamento fra organizzazioni.
 *
 * Non verificano che il codice applicativo filtri correttamente: verificano che
 * il DATABASE rifiuti l'accesso anche se il codice sbagliasse. È l'unica
 * garanzia che regge di fronte a un bug applicativo.
 */

let ctx: TestDatabase;
let daniel: { userId: string; organizationId: string };
let estranea: { userId: string; organizationId: string };
let projectDanielId: string;
let chapterId: string;

beforeAll(async () => {
  ctx = await createTestDatabase();

  daniel = await createUser(ctx.db, 'daniel@esempio.it', 'Daniel Meloni');
  estranea = await createUser(ctx.db, 'estranea@altrodominio.it', 'Utente Estranea');

  // Dati creati con privilegi di servizio, come farebbe uno step di workflow.
  const project = await ctx.db.query<{ id: string }>(
    `insert into public.projects (organization_id, slug, title, author, created_by)
     values ($1, 'dataform-in-pratica', 'Dataform in Pratica', 'Daniel Meloni', $2)
     returning id`,
    [daniel.organizationId, daniel.userId],
  );
  projectDanielId = project.rows[0]!.id;

  const chapter = await ctx.db.query<{ id: string }>(
    `insert into public.chapters (project_id, organization_id, number, label, title, slug, order_index)
     values ($1, $2, 11, '11', 'Incremental Tables', 'incremental-tables', 11)
     returning id`,
    [projectDanielId, daniel.organizationId],
  );
  chapterId = chapter.rows[0]!.id;

  await ctx.db.query(
    `insert into public.chapter_versions (chapter_id, project_id, organization_id, version_no, origin, content_md, content_hash)
     values ($1, $2, $3, 1, 'original', '# Incremental Tables', repeat('a', 64))`,
    [chapterId, projectDanielId, daniel.organizationId],
  );
}, 120_000);

afterAll(async () => {
  await ctx?.close();
});

describe('lettura', () => {
  it('il proprietario vede i propri progetti', async () => {
    const rows = await ctx.as(daniel.userId, async () =>
      ctx.db.query<{ title: string }>('select title from public.projects'),
    );
    expect(rows.rows.map((r) => r.title)).toEqual(['Dataform in Pratica']);
  });

  it('un utente di un’altra organizzazione non vede nulla', async () => {
    const rows = await ctx.as(estranea.userId, async () =>
      ctx.db.query('select * from public.projects'),
    );
    expect(rows.rows).toEqual([]);
  });

  it('l’isolamento vale anche per capitoli, versioni e sorgenti', async () => {
    const risultati = await ctx.as(estranea.userId, async () => ({
      chapters: (await ctx.db.query('select * from public.chapters')).rows,
      versions: (await ctx.db.query('select * from public.chapter_versions')).rows,
      sources: (await ctx.db.query('select * from public.project_sources')).rows,
      files: (await ctx.db.query('select * from public.source_files')).rows,
    }));

    expect(risultati.chapters).toEqual([]);
    expect(risultati.versions).toEqual([]);
    expect(risultati.sources).toEqual([]);
    expect(risultati.files).toEqual([]);
  });

  it('una richiesta senza utente autenticato non restituisce dati', async () => {
    const rows = await ctx.as(null, async () => ctx.db.query('select * from public.projects'));
    expect(rows.rows).toEqual([]);
  });
});

describe('scrittura', () => {
  it('un estraneo non può creare un progetto in un’organizzazione altrui', async () => {
    await expect(
      ctx.as(estranea.userId, async () =>
        ctx.db.query(
          `insert into public.projects (organization_id, slug, title, created_by)
           values ($1, 'intruso', 'Progetto intruso', $2)`,
          [daniel.organizationId, estranea.userId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('un estraneo non può modificare un capitolo altrui', async () => {
    const result = await ctx.as(estranea.userId, async () =>
      ctx.db.query("update public.chapters set title = 'Dirottato' where id = $1", [chapterId]),
    );
    // La UPDATE non fallisce: semplicemente non trova righe visibili.
    expect(result.affectedRows ?? 0).toBe(0);

    const check = await ctx.db.query<{ title: string }>(
      'select title from public.chapters where id = $1',
      [chapterId],
    );
    expect(check.rows[0]!.title).toBe('Incremental Tables');
  });

  it('un estraneo non può cancellare dati altrui', async () => {
    const result = await ctx.as(estranea.userId, async () =>
      ctx.db.query('delete from public.projects where id = $1', [projectDanielId]),
    );
    expect(result.affectedRows ?? 0).toBe(0);

    const check = await ctx.db.query('select id from public.projects where id = $1', [projectDanielId]);
    expect(check.rows).toHaveLength(1);
  });

  it('il proprietario può creare un progetto nella propria organizzazione', async () => {
    const result = await ctx.as(daniel.userId, async () =>
      ctx.db.query<{ id: string }>(
        `insert into public.projects (organization_id, slug, title, created_by)
         values ($1, 'secondo-volume', 'Secondo Volume', $2)
         returning id`,
        [daniel.organizationId, daniel.userId],
      ),
    );
    expect(result.rows).toHaveLength(1);
  });
});

describe('appartenenze e profili', () => {
  it('la policy su organization_members non entra in ricorsione', async () => {
    const rows = await ctx.as(daniel.userId, async () =>
      ctx.db.query<{ role: string }>('select role from public.organization_members'),
    );
    expect(rows.rows.map((r) => r.role)).toEqual(['owner']);
  });

  it('ognuno vede soltanto il proprio profilo', async () => {
    const rows = await ctx.as(daniel.userId, async () =>
      ctx.db.query<{ id: string }>('select id from public.profiles'),
    );
    expect(rows.rows.map((r) => r.id)).toEqual([daniel.userId]);
  });

  it('un utente non può inserirsi in un’organizzazione altrui', async () => {
    await expect(
      ctx.as(estranea.userId, async () =>
        ctx.db.query(
          `insert into public.organization_members (organization_id, user_id, role)
           values ($1, $2, 'owner')`,
          [daniel.organizationId, estranea.userId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('registri riservati', () => {
  it('il client non può scrivere su usage_events né su audit_log', async () => {
    await expect(
      ctx.as(daniel.userId, async () =>
        ctx.db.query(
          `insert into public.usage_events (organization_id, provider, model)
           values ($1, 'openai', 'gpt-test')`,
          [daniel.organizationId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);

    await expect(
      ctx.as(daniel.userId, async () =>
        ctx.db.query(
          `insert into public.audit_log (organization_id, actor_id, action, entity_type)
           values ($1, $2, 'test', 'project')`,
          [daniel.organizationId, daniel.userId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('immutabilità del contenuto originale', () => {
  it('la versione originale non può essere riscritta', async () => {
    await expect(
      ctx.db.query(
        `update public.chapter_versions set content_md = 'testo manomesso'
          where chapter_id = $1 and version_no = 1`,
        [chapterId],
      ),
    ).rejects.toThrow(/immutabile/i);
  });

  it('una revisione aggiunge una versione senza toccare l’originale', async () => {
    await ctx.as(daniel.userId, async () =>
      ctx.db.query(
        `insert into public.chapter_versions
           (chapter_id, project_id, organization_id, version_no, origin, content_md, content_hash, created_by)
         values ($1, $2, $3, 2, 'ai_proposal', '# Incremental Tables (revisione)', repeat('b', 64), $4)`,
        [chapterId, projectDanielId, daniel.organizationId, daniel.userId],
      ),
    );

    const versions = await ctx.db.query<{ version_no: number; content_md: string }>(
      'select version_no, content_md from public.chapter_versions where chapter_id = $1 order by version_no',
      [chapterId],
    );
    expect(versions.rows).toHaveLength(2);
    expect(versions.rows[0]!.content_md).toBe('# Incremental Tables');
  });
});

describe('storage', () => {
  it('un estraneo non può leggere gli oggetti di un’altra organizzazione', async () => {
    await ctx.db.query(
      `insert into storage.objects (bucket_id, name) values ('project-sources', $1)`,
      [`${daniel.organizationId}/${projectDanielId}/manuale.zip`],
    );

    const suoi = await ctx.as(daniel.userId, async () =>
      ctx.db.query('select name from storage.objects'),
    );
    expect(suoi.rows).toHaveLength(1);

    const altrui = await ctx.as(estranea.userId, async () =>
      ctx.db.query('select name from storage.objects'),
    );
    expect(altrui.rows).toEqual([]);
  });

  it('un percorso senza organizzazione valida non è accessibile', async () => {
    await ctx.db.query(
      `insert into storage.objects (bucket_id, name) values ('project-sources', 'percorso/senza/organizzazione.zip')`,
    );

    const rows = await ctx.as(daniel.userId, async () =>
      ctx.db.query('select name from storage.objects where name not like $1', [
        `${daniel.organizationId}%`,
      ]),
    );
    expect(rows.rows).toEqual([]);
  });
});
