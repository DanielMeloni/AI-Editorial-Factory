# Supabase

Configurazione del database, migration versionate e seed di sviluppo.

## Applicare lo schema

Due strade equivalenti. **Usane una sola.**

### A · CLI (consigliata)

Mantiene lo storico delle migration e permette gli aggiornamenti incrementali
delle fasi successive.

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Il `<project-ref>` è la parte iniziale dell'URL del progetto:
`https://`**`abcdefghijklm`**`.supabase.co`.

### B · SQL Editor del dashboard

Per una prima installazione senza CLI: apri *SQL Editor → New query*, incolla
il contenuto di [`setup-completo.sql`](setup-completo.sql) e premi **Run**.

⚠ **Il file contiene un'interruzione obbligatoria**, segnalata da un riquadro
ben visibile. Esegui tutto ciò che la precede, attendi il completamento, poi
esegui separatamente ciò che segue. PostgreSQL non permette di usare un valore
di enum nella stessa transazione in cui viene aggiunto, e gli agenti di collana
usano valori introdotti dalla migration precedente. Con `npx supabase db push`
l'interruzione non serve: ogni migration è già una transazione a sé.

Il file non è idempotente: eseguirlo due volte sullo stesso progetto fallisce
sul primo tipo già esistente. Rigeneralo dopo ogni modifica alle migration con
`npm run db:bundle`.

## Sviluppo in locale

Richiede Docker.

```bash
npm run db:start    # Postgres, Auth e Storage in locale
npm run db:reset    # riapplica tutte le migration da zero
npm run db:types    # genera src/lib/supabase/database.types.ts
npm run db:stop
```

Senza Docker, i test dello schema e della RLS girano comunque: usano PGlite,
PostgreSQL compilato in WebAssembly (`npm test`).

## Le quattordici migration

| File | Contenuto |
|---|---|
| `…0001_enums.sql` | 20 tipi enumerati |
| `…0002_identity.sql` | Profili, organizzazioni, appartenenze, provisioning |
| `…0003_projects_sources.sql` | Progetti e archivi sorgente |
| `…0004_editorial.sql` | Manifesto, parti, capitoli, versioni, citazioni |
| `…0005_agents_workflows.sql` | Agenti, workflow, esecuzioni, problemi |
| `…0006_reviews.sql` | Richieste di revisione e commenti |
| `…0007_visual_cover.sql` | Asset visuali e Cover Studio |
| `…0008_publication.sql` | Output, esportazioni, consumo AI, audit |
| `…0009_rls.sql` | Row Level Security su tutte le tabelle |
| `…0010_storage.sql` | Tre bucket privati e relative policy |
| `…0011_indexes.sql` | Indici |
| `…0012_seed_agents.sql` | Catalogo dei dodici agenti |
| `…130001_series.sql` | Collane editoriali: 17 tabelle *(fondamenta Fase 8)* |
| `…130002_series_agents.sql` | Catalogo dei sei agenti di collana |

Le migration sono **additive**. Non modificarne una già applicata: aggiungine
una nuova.

## Risultato atteso

Dopo l'applicazione, il progetto contiene:

| Elemento | Quantità |
|---|---|
| Tabelle in `public` | 42 |
| Tabelle senza RLS | **0** |
| Policy (public + storage) | 99 |
| Tipi enumerati | 20 |
| Indici | 127 |
| Bucket privati | 3 |
| Agenti in catalogo | 18 (nessuno ancora operativo) |

Verifica rapida dal SQL Editor:

```sql
select count(*) filter (where relrowsecurity and relforcerowsecurity) as con_rls,
       count(*)                                                       as totali
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r';
```

Le due colonne devono coincidere.

## Configurazione dell'autenticazione

Da fare una volta nel dashboard, non è coperta dalle migration.

1. *Authentication → Sign In / Providers → Email*: abilita **Email**, lascia
   attivo **Confirm email**, imposta la lunghezza minima password a **10**
   caratteri per allinearla alla validazione dell'applicazione.
2. *Authentication → URL Configuration*:
   - **Site URL**: `http://localhost:3000` in sviluppo, il dominio di produzione
     su Vercel;
   - **Redirect URLs**: `http://localhost:3000/auth/callback` e
     `https://<dominio>/auth/callback`.
3. *Project Settings → API Keys*: copia Project URL, publishable key e secret key
   in `.env.local`.

## Bucket

Creati dalla migration 10, tutti **privati**:

| Bucket | Contenuto | Limite |
|---|---|---|
| `project-sources` | Archivi ZIP caricati | 1 GiB |
| `generated-assets` | Diagrammi e illustrazioni | 50 MiB |
| `publication-exports` | Markdown, HTML, PDF prodotti | 512 MiB |

Percorso, identico nei tre: `{organization_id}/{project_id}/…`. Il primo
segmento è sempre l'organizzazione: le policy decidono su quello. L'accesso
avviene solo tramite URL firmati a scadenza.

## Seed

`seed.sql` non esiste ancora: alla Fase 2 non c'è nulla da precaricare oltre al
catalogo degli agenti, già incluso nella migration 12. I dati di sviluppo
arriveranno con la Fase 3, senza alcuna credenziale reale.
