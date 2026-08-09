import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Banco di prova per lo schema.
 *
 * Esegue le migration reali su un PostgreSQL in-process (PGlite), con gli
 * oggetti Supabase che il progetto usa ma che non fanno parte delle migration:
 * i ruoli, lo schema `auth` e lo schema `storage`.
 *
 * `auth.uid()` legge una variabile di sessione, cosi' i test possono
 * impersonare un utente e verificare davvero le policy RLS.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

const SUPABASE_STUBS = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema if not exists auth;
create schema if not exists storage;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Restituisce l'utente impersonato dal test.
create or replace function auth.uid() returns uuid
language sql stable
as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fn$;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text not null references storage.buckets (id) on delete cascade,
  name       text not null,
  owner      uuid,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;
alter table storage.objects force row level security;

-- Supabase concede questi privilegi per impostazione predefinita. Riprodurli e'
-- indispensabile: senza, i test fallirebbero per mancanza di GRANT e non per
-- effetto delle policy, mascherando il comportamento reale della RLS.
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- I privilegi predefiniti valgono per le tabelle create dalle migration
-- successive, come avviene su Supabase. La migration 09 potra' quindi
-- revocarli ad anon, e la revoca sara' significativa.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export interface TestDatabase {
  db: PGlite;
  /** Esegue una funzione impersonando un utente, con il ruolo authenticated. */
  as<T>(userId: string | null, fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file} fallita: ${(error as Error).message}`);
    }
  }

  async function as<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
    await db.exec("set role authenticated;");
    await db.query('select set_config($1, $2, false)', [
      'request.jwt.claim.sub',
      userId ?? '',
    ]);
    try {
      return await fn();
    } finally {
      await db.exec('reset role;');
      await db.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', '']);
    }
  }

  return {
    db,
    as,
    close: () => db.close(),
  };
}

/** Crea un utente e lascia che il trigger generi profilo, organizzazione e appartenenza. */
export async function createUser(
  db: PGlite,
  email: string,
  fullName: string,
): Promise<{ userId: string; organizationId: string }> {
  const inserted = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data)
     values ($1, jsonb_build_object('full_name', $2::text))
     returning id`,
    [email, fullName],
  );
  const userId = inserted.rows[0]!.id;

  const org = await db.query<{ organization_id: string }>(
    'select organization_id from public.organization_members where user_id = $1',
    [userId],
  );

  return { userId, organizationId: org.rows[0]!.organization_id };
}
