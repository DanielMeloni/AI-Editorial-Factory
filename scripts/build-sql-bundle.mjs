import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Rigenera supabase/setup-completo.sql concatenando le migration in ordine.
 * Serve a chi applica lo schema dall'SQL Editor invece che dalla CLI.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const OUTPUT = join(process.cwd(), 'supabase', 'setup-completo.sql');
const RULE = '═'.repeat(75);

const HEADER = `-- =============================================================================
-- AI Editorial Factory · Schema completo
-- -----------------------------------------------------------------------------
-- ATTENZIONE — questo file è un'ALTERNATIVA a \`npx supabase db push\`, non un
-- complemento. Applicalo in UNO dei due modi, mai in entrambi:
--
--   A) CLI (consigliato, mantiene lo storico delle migration):
--        npx supabase link --project-ref <project-ref>
--        npx supabase db push
--
--   B) SQL Editor del dashboard Supabase:
--        incolla QUESTO file e premi Run, rispettando l'INTERRUZIONE
--        OBBLIGATORIA segnalata più avanti nel file.
--
-- Il contenuto è la concatenazione, nell'ordine, di tutte le migration in
-- supabase/migrations/, comprese le fondamenta delle collane (Fase 8). Non modificarlo a mano: rigeneralo con
--        npm run db:bundle
--
-- Idempotenza: NON è idempotente. Eseguirlo due volte sullo stesso progetto
-- fallisce sul primo CREATE TYPE già esistente. Per ripartire da zero usa
-- \`npx supabase db reset\` in locale, oppure un progetto Supabase nuovo.
--
-- Prerequisiti: un progetto Supabase con gli schemi \`auth\` e \`storage\`
-- (presenti per impostazione predefinita) e Postgres 15 o successivo.
-- =============================================================================
`;

/**
 * Migration che DEVONO iniziare in una nuova transazione.
 *
 * PostgreSQL non consente di usare un valore di enum nella stessa transazione
 * in cui viene aggiunto con `ALTER TYPE ... ADD VALUE`. Con la CLI il problema
 * non si pone — ogni file è una transazione — ma chi incolla il bundle
 * nell'SQL Editor esegue tutto insieme e otterrebbe un errore oscuro.
 */
const TRANSACTION_BOUNDARIES = new Set(['20260809130002_series_agents.sql']);

const BREAK = `
-- ${'▄'.repeat(72)}
--
--   ⚠  INTERRUZIONE OBBLIGATORIA — SOLO PER L'SQL EDITOR
--
--   Se stai incollando questo file nell'SQL Editor di Supabase, fermati qui:
--   esegui tutto ciò che precede, attendi il completamento, poi esegui
--   separatamente ciò che segue.
--
--   Motivo: PostgreSQL non permette di usare un valore di enum nella stessa
--   transazione in cui viene aggiunto con ALTER TYPE ... ADD VALUE.
--
--   Con \`npx supabase db push\` questa interruzione non serve: ogni migration
--   è già una transazione a sé.
--
-- ${'▀'.repeat(72)}
`;

const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
const chunks = [HEADER];

for (const file of files) {
  const body = (await readFile(join(MIGRATIONS_DIR, file), 'utf8')).trimEnd();
  if (TRANSACTION_BOUNDARIES.has(file)) chunks.push(BREAK);
  chunks.push(`\n-- ${RULE}\n-- ▶ ${file}\n-- ${RULE}\n\n${body}\n`);
}

await writeFile(OUTPUT, chunks.join(''), 'utf8');
console.log(`setup-completo.sql rigenerato da ${files.length} migration.`);
