import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createUser, type TestDatabase } from './harness';

/**
 * La biblioteca delle fonti sul database reale.
 *
 * Due cose vanno verificate qui e non nel codice applicativo: che i vincoli
 * impediscano stati incoerenti anche a chi scrive con privilegi di servizio, e
 * che un'organizzazione non veda la biblioteca di un'altra nemmeno se il codice
 * dimenticasse un filtro.
 */

let ctx: TestDatabase;
let daniel: { userId: string; organizationId: string };
let estranea: { userId: string; organizationId: string };
let projectId: string;

beforeAll(async () => {
  ctx = await createTestDatabase();

  daniel = await createUser(ctx.db, 'daniel@esempio.it', 'Daniel Meloni');
  estranea = await createUser(ctx.db, 'estranea@altrodominio.it', 'Utente Estranea');

  const project = await ctx.db.query<{ id: string }>(
    `insert into public.projects (organization_id, slug, title, author, created_by)
     values ($1, 'dataform-in-pratica', 'Dataform in Pratica', 'Daniel Meloni', $2)
     returning id`,
    [daniel.organizationId, daniel.userId],
  );
  projectId = project.rows[0]!.id;
}, 120_000);

afterAll(async () => {
  await ctx?.close();
});

async function inserisciLink(over: Record<string, unknown> = {}) {
  const valori = {
    scope: 'project',
    project_id: projectId,
    url: 'https://esempio.org/specifica',
    storage_path: null,
    ...over,
  };

  return ctx.db.query(
    `insert into public.reference_sources
       (organization_id, project_id, kind, scope, title, url, storage_path)
     values ($1, $2, 'link', $3, 'Specifica', $4, $5)
     returning id`,
    [
      daniel.organizationId,
      valori.project_id,
      valori.scope,
      valori.url,
      valori.storage_path,
    ],
  );
}

describe('vincoli sulle fonti', () => {
  it('accetta un link di progetto', async () => {
    const inserted = await inserisciLink();
    expect(inserted.rows).toHaveLength(1);
  });

  it('accetta una fonte dell’organizzazione, senza progetto', async () => {
    const inserted = await inserisciLink({ scope: 'organization', project_id: null });
    expect(inserted.rows).toHaveLength(1);
  });

  it('rifiuta una fonte di organizzazione legata a un progetto', async () => {
    // Sarebbe ambigua: ereditata da tutti, ma di uno solo.
    await expect(inserisciLink({ scope: 'organization' })).rejects.toThrow();
  });

  it('rifiuta una fonte di progetto senza progetto', async () => {
    await expect(inserisciLink({ project_id: null })).rejects.toThrow();
  });

  it('rifiuta un link senza indirizzo e un link con un file', async () => {
    await expect(inserisciLink({ url: null })).rejects.toThrow();
    await expect(inserisciLink({ storage_path: 'org/prog/x.pdf' })).rejects.toThrow();
  });

  it('rifiuta un PDF senza file', async () => {
    await expect(
      ctx.db.query(
        `insert into public.reference_sources
           (organization_id, project_id, kind, scope, title, url, storage_path)
         values ($1, $2, 'pdf', 'project', 'Norma', null, null)`,
        [daniel.organizationId, projectId],
      ),
    ).rejects.toThrow();
  });

  it('rifiuta un titolo vuoto', async () => {
    await expect(
      ctx.db.query(
        `insert into public.reference_sources
           (organization_id, project_id, kind, scope, title, url)
         values ($1, $2, 'link', 'project', '   ', 'https://esempio.org')`,
        [daniel.organizationId, projectId],
      ),
    ).rejects.toThrow();
  });

  it('rifiuta due blocchi con lo stesso indice sulla stessa fonte', async () => {
    const fonte = await inserisciLink();
    const referenceId = (fonte.rows[0] as { id: string }).id;

    const inserisciBlocco = () =>
      ctx.db.query(
        `insert into public.reference_chunks
           (reference_id, organization_id, project_id, chunk_index, page, content, terms)
         values ($1, $2, $3, 0, 1, 'Testo del blocco.', array['testo'])`,
        [referenceId, daniel.organizationId, projectId],
      );

    await inserisciBlocco();
    await expect(inserisciBlocco()).rejects.toThrow();
  });

  it('rimuove i blocchi insieme alla fonte', async () => {
    const fonte = await inserisciLink();
    const referenceId = (fonte.rows[0] as { id: string }).id;

    await ctx.db.query(
      `insert into public.reference_chunks
         (reference_id, organization_id, project_id, chunk_index, content)
       values ($1, $2, $3, 0, 'Testo.')`,
      [referenceId, daniel.organizationId, projectId],
    );
    await ctx.db.query('delete from public.reference_sources where id = $1', [referenceId]);

    const rimasti = await ctx.db.query<{ count: string }>(
      'select count(*)::text as count from public.reference_chunks where reference_id = $1',
      [referenceId],
    );
    expect(rimasti.rows[0]!.count).toBe('0');
  });
});

describe('vincoli sulle proposte', () => {
  let chapterId: string;

  beforeAll(async () => {
    const chapter = await ctx.db.query<{ id: string }>(
      `insert into public.chapters (project_id, organization_id, number, label, title, slug, order_index)
       values ($1, $2, 11, '11', 'Incremental Tables', 'incremental-tables-2', 11)
       returning id`,
      [projectId, daniel.organizationId],
    );
    chapterId = chapter.rows[0]!.id;
  });

  const base = `insert into public.source_suggestions
      (project_id, organization_id, chapter_id, claim_line, claim_excerpt, category,
       url, title, score, rank, origin, reference_id)`;

  it('accetta una proposta dal catalogo ufficiale', async () => {
    const inserted = await ctx.db.query(
      `${base} values ($1, $2, $3, 3, 'Affermazione.', 'costo',
        'https://docs.cloud.google.com/dataform/docs/create-tables', 'Creare tabelle', 2.5, 1,
        'catalogo_ufficiale', null) returning id`,
      [projectId, daniel.organizationId, chapterId],
    );
    expect(inserted.rows).toHaveLength(1);
  });

  it('accetta una proposta della biblioteca senza indirizzo, con la pagina', async () => {
    const fonte = await inserisciLink();
    const referenceId = (fonte.rows[0] as { id: string }).id;

    const inserted = await ctx.db.query(
      `insert into public.source_suggestions
         (project_id, organization_id, chapter_id, claim_line, claim_excerpt, category,
          url, title, score, rank, origin, reference_id, page)
       values ($1, $2, $3, 8, 'Affermazione.', 'comportamento', null, 'Norma', 4.2, 1,
         'biblioteca', $4, 12)
       returning id`,
      [projectId, daniel.organizationId, chapterId, referenceId],
    );
    expect(inserted.rows).toHaveLength(1);
  });

  it('rifiuta una proposta della biblioteca senza fonte alle spalle', async () => {
    await expect(
      ctx.db.query(
        `${base} values ($1, $2, $3, 3, 'A.', 'costo', 'https://esempio.org', 'X', 1, 1,
          'biblioteca', null)`,
        [projectId, daniel.organizationId, chapterId],
      ),
    ).rejects.toThrow();
  });

  it('rifiuta una proposta senza indirizzo né fonte: sarebbe irrintracciabile', async () => {
    await expect(
      ctx.db.query(
        `${base} values ($1, $2, $3, 3, 'A.', 'costo', null, 'X', 1, 1,
          'catalogo_ufficiale', null)`,
        [projectId, daniel.organizationId, chapterId],
      ),
    ).rejects.toThrow();
  });

  it('rifiuta una decisione senza data', async () => {
    await expect(
      ctx.db.query(
        `insert into public.source_suggestions
           (project_id, organization_id, chapter_id, claim_line, claim_excerpt, category,
            url, title, score, rank, status, decided_at)
         values ($1, $2, $3, 3, 'A.', 'costo', 'https://esempio.org', 'X', 1, 1,
           'accepted', null)`,
        [projectId, daniel.organizationId, chapterId],
      ),
    ).rejects.toThrow();
  });
});

describe('isolamento fra organizzazioni', () => {
  beforeAll(async () => {
    await inserisciLink();
  });

  it('il proprietario vede la propria biblioteca', async () => {
    const rows = await ctx.as(daniel.userId, async () =>
      ctx.db.query<{ count: string }>(
        'select count(*)::text as count from public.reference_sources',
      ),
    );
    expect(Number(rows.rows[0]!.count)).toBeGreaterThan(0);
  });

  it('un’altra organizzazione non vede nulla', async () => {
    const rows = await ctx.as(estranea.userId, async () =>
      ctx.db.query<{ count: string }>(
        'select count(*)::text as count from public.reference_sources',
      ),
    );
    expect(rows.rows[0]!.count).toBe('0');
  });

  it('un’altra organizzazione non vede i blocchi indicizzati', async () => {
    const fonte = await inserisciLink();
    const referenceId = (fonte.rows[0] as { id: string }).id;
    await ctx.db.query(
      `insert into public.reference_chunks
         (reference_id, organization_id, project_id, chunk_index, content)
       values ($1, $2, $3, 0, 'Contenuto riservato.')`,
      [referenceId, daniel.organizationId, projectId],
    );

    const rows = await ctx.as(estranea.userId, async () =>
      ctx.db.query<{ count: string }>('select count(*)::text as count from public.reference_chunks'),
    );
    expect(rows.rows[0]!.count).toBe('0');
  });

  it('un’altra organizzazione non può inserire nella biblioteca altrui', async () => {
    await expect(
      ctx.as(estranea.userId, async () =>
        ctx.db.query(
          `insert into public.reference_sources
             (organization_id, project_id, kind, scope, title, url)
           values ($1, $2, 'link', 'project', 'Intruso', 'https://esempio.org')`,
          [daniel.organizationId, projectId],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('il bucket accoglie i PDF di riferimento', () => {
  it('accetta application/pdf fra i tipi ammessi', async () => {
    const rows = await ctx.db.query<{ allowed_mime_types: string[] }>(
      "select allowed_mime_types from storage.buckets where id = 'project-sources'",
    );
    expect(rows.rows[0]!.allowed_mime_types).toContain('application/pdf');
  });
});
