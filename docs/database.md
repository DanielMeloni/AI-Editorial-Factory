# Database

> Stato: **Fase 2**. Schema completo, RLS attiva, migration eseguite e verificate
> da test automatici.

## 1. Come eseguire le migration

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push          # applica le migration al progetto remoto
```

In locale, con Docker:

```bash
npm run db:start              # avvia Postgres, Auth e Storage
npm run db:reset              # riapplica tutte le migration da zero
npm run db:types              # genera src/lib/supabase/database.types.ts
```

Le migration sono **additive e ordinate per timestamp**. Non modificarne una già
applicata: aggiungerne una nuova.

## 2. Le diciotto migration

| File | Contenuto |
|---|---|
| `…0001_enums.sql` | 19 tipi enumerati: ruoli, stati, categorie |
| `…0002_identity.sql` | `profiles`, `organizations`, `organization_members`, funzioni di appartenenza, provisioning automatico |
| `…0003_projects_sources.sql` | `projects`, `project_sources`, `source_files`, `source_chunks` |
| `…0004_editorial.sql` | `project_manifests`, `publication_parts`, `chapters`, `chapter_versions`, `citations`, `style_guides` |
| `…0005_agents_workflows.sql` | `agent_definitions`, `workflow_runs`, `agent_runs`, `verification_issues` |
| `…0006_reviews.sql` | `review_requests`, `review_comments` |
| `…0007_visual_cover.sql` | `visual_assets`, `cover_projects` |
| `…0008_publication.sql` | `publication_outputs`, `exports`, `usage_events`, `audit_log` |
| `…0009_rls.sql` | Row Level Security su tutte le 25 tabelle |
| `…0010_storage.sql` | Tre bucket privati e relative policy |
| `…0011_indexes.sql` | Indici su chiavi esterne e percorsi di lettura frequenti |
| `…0012_seed_agents.sql` | Catalogo dei dodici agenti |
| `…130001_series.sql` | **Collane editoriali**: 17 tabelle, RLS, vincoli, indici *(fondamenta della Fase 8)* |
| `…130002_series_agents.sql` | Catalogo dei sei agenti di collana |
| `…140001_source_research.sql` | `source_suggestions`: le fonti proposte automaticamente, con RLS e indici |
| `…140002_reference_library.sql` | `reference_sources`, `reference_chunks`: la biblioteca di link e PDF, indicizzata |
| `…140003_reference_proposed.sql` | Stato `proposed`, in una transazione a sé come impone `ALTER TYPE … ADD VALUE` |
| `…140004_web_discovery.sql` | Provenienza, motivazione ed esito della verifica sulle fonti trovate sul web |

## 3. Il modello in breve

```
organizations ──< organization_members >── profiles ── auth.users
      │
      └──< projects
             ├──< project_sources ──< source_files ──< source_chunks
             ├──< project_manifests ──< publication_parts ──< chapters
             │                                                  │
             │                                                  └──< chapter_versions
             ├──< workflow_runs ──< agent_runs ──< verification_issues
             ├──< review_requests ──< review_comments
             ├──< visual_assets · cover_projects
             └──< publication_outputs ──< exports
```

Ogni tabella editoriale porta `organization_id` **denormalizzato**. Non è una
ridondanza casuale: consente alla policy RLS di decidere senza join, e rende
impossibile spostare una riga fra organizzazioni senza violare la coerenza con
il progetto.

## 4. Isolamento fra organizzazioni

La regola è una sola: *un utente vede e modifica soltanto i dati delle
organizzazioni di cui è membro*.

```sql
create policy … using (public.is_org_member(organization_id));
```

Tre dettagli che rendono la regola effettiva:

**`FORCE ROW LEVEL SECURITY`**, non solo `ENABLE`. Senza `FORCE`, il proprietario
della tabella ignorerebbe le proprie policy.

**`is_org_member()` è `SECURITY DEFINER`.** Una policy su `organization_members`
che interrogasse `organization_members` entrerebbe in ricorsione infinita. La
funzione gira con i privilegi del proprietario e spezza il ciclo. Ha
`search_path` fissato per impedire il dirottamento dei nomi.

**Il ruolo `anon` non ha alcun accesso.** La migration 09 revoca esplicitamente
ogni privilegio: senza sessione, nessun dato editoriale è raggiungibile.

`usage_events` e `audit_log` hanno policy di lettura ma **nessuna policy di
INSERT**: il client non può scriverci per costruzione. Solo il service role,
confinato al server, registra consumi ed eventi.

## 5. Immutabilità del contenuto originale

`chapter_versions` è append-only. La versione 1 ha `origin = 'original'` e un
trigger impedisce di riscriverne il testo:

```sql
create trigger chapter_versions_protect_original
  before update on public.chapter_versions
  for each row execute function public.protect_original_version();
```

Una revisione AI o umana aggiunge una riga con `version_no` successivo e
`parent_version_id` valorizzato. Nulla viene mai sovrascritto, e ogni versione
resta confrontabile e ripristinabile.

## 6. Provisioning alla registrazione

Il trigger `on_auth_user_created` crea, in una sola transazione: il profilo,
un'organizzazione personale con slug univoco, e l'appartenenza come `owner`.

Senza di esso un utente appena registrato non apparterrebbe ad alcuna
organizzazione e non potrebbe creare progetti — e la RLS, correttamente, glielo
impedirebbe.

## 7. Storage

Tre bucket, tutti **privati**:

| Bucket | Contenuto | Limite |
|---|---|---|
| `project-sources` | Archivi ZIP caricati | 1 GiB |
| `generated-assets` | Diagrammi e illustrazioni | 50 MiB |
| `publication-exports` | Markdown, HTML, PDF prodotti | 512 MiB |

Convenzione di percorso, identica nei tre:

```
{organization_id}/{project_id}/...
```

Il primo segmento è sempre l'organizzazione: la funzione
`storage_object_org(name)` lo estrae e la policy decide su quello, senza
interrogare altre tabelle. Un percorso il cui primo segmento non sia un UUID
valido non è accessibile a nessuno.

L'accesso avviene esclusivamente tramite **URL firmati a scadenza**, emessi dal
server dopo la verifica di appartenenza.

## 8. Indici

Regola adottata: ogni chiave esterna a colonna singola ha un indice che la usa
come **prima** colonna. Unica eccezione, motivata: le colonne che indicano
l'autore di un'azione (`created_by`, `approved_by`, `requested_by`, …)
referenziano `auth.users` con `ON DELETE SET NULL`; sono scritte sempre e
interrogate quasi mai.

La regola non è affidata alla disciplina: è verificata da un test che interroga
`pg_constraint` e fallisce se una FK resta scoperta.

## 9. Test dello schema

I test girano su **PGlite** — PostgreSQL 18 compilato in WebAssembly — quindi non
richiedono Docker e si eseguono con il resto della suite:

```bash
npm test
```

`tests/db/harness.ts` riproduce gli oggetti che Supabase fornisce e che non
fanno parte delle migration: i ruoli `anon`/`authenticated`/`service_role`, lo
schema `auth` con `auth.uid()`, lo schema `storage`, e i privilegi predefiniti.
Poi applica le migration reali, nell'ordine reale.

`ctx.as(userId, fn)` esegue una funzione impersonando un utente con il ruolo
`authenticated`: i test verificano quindi il comportamento effettivo delle
policy, non una loro descrizione.

Cosa viene verificato:

- le 25 tabelle esistono e hanno tutte `ENABLE` + `FORCE` RLS;
- ogni chiave esterna rilevante è indicizzata;
- il provisioning crea profilo, organizzazione e appartenenza, con slug univoco
  anche in caso di omonimia;
- un utente di un'altra organizzazione **non vede** progetti, capitoli, versioni,
  fonti e file;
- un estraneo non può inserire, modificare o cancellare dati altrui;
- una richiesta senza utente autenticato non restituisce nulla;
- il client non può scrivere su `usage_events` né su `audit_log`;
- la versione originale di un capitolo non può essere riscritta;
- gli oggetti di storage sono isolati per organizzazione, e un percorso senza
  UUID valido non è accessibile.

## 10. Differenze fra PGlite e Supabase

PGlite è PostgreSQL 18; Supabase usa la 15 o la 17. Lo schema non impiega alcuna
funzionalità introdotta dopo la 15. `auth.uid()` e `storage.objects` sono
riprodotti in forma minima: sufficiente a verificare le policy, non a sostituire
una prova sul progetto reale. Prima del passaggio in produzione, `supabase db
push` su un progetto di staging resta il collaudo definitivo.


---

## 11. Collane editoriali (migration 13-14)

Fondamenta della **Fase 8**, già applicabili. Progetto completo in
[`docs/series.md`](series.md).

### La decisione da documentare

`projects` **non** riceve `series_id` né `volume_number`. La fonte di verità del
legame collana-progetto è **`series_volumes`**.

Un volume può esistere senza progetto — «Volume 4, previsto per l'autunno» è un
elemento di piano prima che di redazione — e un progetto può esistere senza
collana. La relazione è opzionale su entrambi i lati e porta attributi propri:
data prevista, edizione, ISBN, dipendenze, deroghe. È un'entità, non una
colonna.

Duplicare il legame creerebbe due percorsi verso la stessa verità, che prima o
poi divergono senza che alcun vincolo se ne accorga. Un test lo impone:
`projects` non deve avere quelle colonne.

### Vincoli imposti dal database

| Vincolo | Meccanismo |
|---|---|
| Numero di volume univoco nella collana | `unique (series_id, volume_number)` |
| Un progetto in un solo volume | `unique (project_id)` |
| Un volume pubblicato dichiara la data | `check` |
| Un volume pubblicato non si cancella | trigger `protect_published_volume` |
| Una versione di stile pubblicata è immutabile | trigger `protect_published_style_version` |
| Una sola versione corrente per collana e tipo | indice unico parziale |
| Deroga senza motivazione rifiutata | `check` su lunghezza minima |
| Deroga su regola `locked` rifiutata | trigger `reject_override_on_locked_rule` |
| Nessun riferimento di un volume a sé stesso | `check` |
| RLS su tutte e diciassette | `ENABLE` + `FORCE`, come il resto |

### Verifica

`tests/db/series.test.ts` applica le migration su PostgreSQL reale e verifica 23
proprietà: presenza e RLS delle diciassette tabelle, **assenza** delle colonne su
`projects`, ogni vincolo elencato sopra, e l'isolamento fra organizzazioni su
collane, volumi, regole, deroghe, glossario e riferimenti incrociati.

---

## 12. Fonti proposte (migration 15)

`source_suggestions` tiene le pagine ufficiali che il Source Auditor propone per
le affermazioni prive di rimando. È una tabella distinta da `citations`, e la
distinzione è sostanziale: `citations` descrive che cosa il capitolo cita
davvero, `source_suggestions` che cosa la macchina suggerisce di citare. Una
proposta diventa una citazione solo quando un revisore la accetta.

| Colonna | Perché c'è |
|---|---|
| `claim_line`, `claim_excerpt`, `category` | L'affermazione com'era al momento dell'audit: la proposta resta leggibile anche se il testo cambia |
| `url`, `title`, `section` | Letti dall'indice curato, non generati |
| `score`, `rank`, `matched_terms` | Il **motivo** della proposta: è ciò che il revisore guarda per accettarla o scartarla |
| `status`, `decided_by`, `decided_at` | La decisione umana, con un vincolo che impedisce una decisione senza data |

Su `citations`, `is_reachable` significa ora «risulta nell'indice curato» e resta
**nullo** per ciò che non è stato controllato: un confronto con l'indice non è
una chiamata HTTP, e dichiararlo tale sarebbe una piccola bugia con conseguenze
pratiche.

---

## 13. La biblioteca delle fonti (migration 16)

`reference_sources` tiene i link e i PDF aggiunti a mano; `reference_chunks` il
loro testo indicizzabile, un blocco per volta, con il numero di pagina quando la
fonte è un PDF.

L'ereditarietà è quella delle collane: `project_id` nullo significa «fonte
dell'organizzazione», valida per tutti i suoi progetti. Il vincolo
`reference_sources_scope_coherent` impedisce lo stato ambiguo — dichiararla di
organizzazione e legarla a un progetto — perché una fonte del genere sarebbe
ereditata da tutti ma appartenente a uno solo.

| Vincolo | Che cosa impedisce |
|---|---|
| `reference_sources_target_coherent` | Un link senza indirizzo, un PDF senza file, o una fonte che è entrambi |
| `reference_sources_scope_coherent` | Fonte di organizzazione legata a un progetto, o di progetto senza progetto |
| `reference_sources_title_present` | Un titolo vuoto: renderebbe l'elenco illeggibile |
| `source_suggestions_origin_coherent` | Una proposta «dalla biblioteca» senza una fonte alle spalle |
| `source_suggestions_identifiable` | Una proposta senza indirizzo **né** fonte: sarebbe irrintracciabile |
| `reference_chunks` unique `(reference_id, chunk_index)` | Due blocchi con lo stesso indice sullo stesso documento |

Il bucket `project-sources` accoglie ora anche `application/pdf`: i PDF di
riferimento stanno accanto agli archivi, sotto la stessa convenzione di percorso
`{organization_id}/{project_id}/references/{reference_id}/`, e quindi sotto le
stesse policy di storage.

`tests/db/reference-library.test.ts` verifica ogni vincolo su PostgreSQL reale,
oltre all'isolamento fra organizzazioni su fonti e blocchi.
