# AI Editorial Factory

**Redazione multi-agente per manuali tecnici.**

Piattaforma per trasformare un manuale tecnico grezzo — capitoli Markdown, codice,
appendici, immagini — in un'opera verificata, illustrata e pubblicabile, con agenti AI
specializzati e approvazione umana obbligatoria prima di ogni pubblicazione.

Primo progetto pilota: *Dataform in Pratica – Volume 1* di Daniel Meloni.
L'applicazione è generica: Dataform è il primo caso d'uso, non una personalizzazione.

> **Stato: sette fasi completate su otto.**
> Il flusso è percorribile per intero: registrazione, progetto, importazione
> dell'archivio, riconoscimento della struttura, audit tecnico del capitolo,
> revisione umana, diagrammi, copertina e pubblicazione in Markdown, HTML e PDF.
>
> Ciò che non è implementato resta visibile e **disattivato**, con la dicitura
> «Disponibile prossimamente»: otto dei dodici agenti sul capitolo, tutti e sei
> quelli di collana, e gli adapter verso provider visuali reali.
>
> La **Fase 8 — Collane editoriali** è progettata e ha già le sue fondamenta nel
> database e nei modelli di dominio, ma non ha interfaccia né workflow. Vedi
> [`docs/series.md`](docs/series.md).

---

## Principi non negoziabili

| Principio | Come è garantito |
|---|---|
| Il contenuto originale è immutabile | Ogni intervento AI produce una nuova versione confrontabile e ripristinabile |
| Nessuna pubblicazione automatica | Il workflow si sospende su un gate di approvazione umana |
| Nessun segreto nel browser | Solo la publishable key raggiunge il client; il service role è confinato al server |
| Isolamento fra organizzazioni | Row Level Security su tutte le tabelle esposte |
| Nessun pulsante finto | Ogni comando visibile funziona oppure è disabilitato e dichiarato tale |
| Nessuna fonte inventata | Ogni indirizzo proposto viene aperto prima di essere mostrato: chi non risponde non compare, e il titolo è quello letto dalla pagina |
| Sviluppo senza consumare crediti | Provider AI mock attivo per impostazione predefinita |

---

## Stack

| Ambito | Tecnologia | Versione |
|---|---|---|
| Framework | Next.js (App Router, Turbopack) | 16.3.0 |
| Linguaggio | TypeScript strict | 5.9.3 |
| UI | React | 19.2.8 |
| Stili | Tailwind CSS (configurazione CSS-first) | 4.3.3 |
| Database, Auth, Storage | Supabase | `supabase-js` 2.112.2 · `ssr` 0.12.4 |
| Validazione | Zod | 4.4.3 |
| Workflow durevoli | Workflow SDK (`workflow`) | 4.8.1 |
| Archivi | `fflate` | 0.8.3 |
| Testo dai PDF | `unpdf` | 1.8.1 |
| Markdown → HTML | `unified` · `remark` · `rehype` | 11.x |
| PDF | `@react-pdf/renderer` | 4.6.0 |
| Confronto versioni | `diff` | 9.0.0 |
| Test | Vitest · Playwright | 4.1.10 · 1.62.1 |
| Lint | ESLint · typescript-eslint | 9.39.5 · 8.66.0 |
| Hosting | Vercel | — |

> **Nota su TypeScript.** La versione più recente è la 7.0.2, ma `typescript-eslint@8`
> dichiara peer `<6.1.0`: usarla romperebbe il lint. Restiamo su 5.9.3 finché
> l'ecosistema non si allinea.

> **Nota su ESLint.** La 10.x è incompatibile con `eslint-plugin-react`
> incluso in `eslint-config-next@16` (usa `context.getFilename()`, rimosso in ESLint 10).
> La 9.39.5 è la versione più recente funzionante.

---

## Architettura in breve

Monolite modulare Next.js — nessun microservizio — con workflow asincroni durevoli.

```
src/
├── app/
│   ├── (auth)/          pagine pubbliche: login, registrazione, recupero password
│   ├── (app)/           area privata: dashboard, impostazioni
│   ├── auth/callback/   scambio codice → sessione (PKCE)
│   ├── layout.tsx       tema, toaster, skip link
│   └── globals.css      token di design (Tailwind v4)
├── components/
│   ├── ui/              primitive accessibili e riutilizzabili
│   ├── layout/          sidebar, topbar, breadcrumb, logo
│   └── auth/            form collegati alle Server Action
├── lib/
│   ├── auth/            guardie, schemi Zod, Server Action, mappa delle rotte
│   ├── supabase/        client browser / server / admin / proxy
│   ├── navigation/      voci di menu e stato di disponibilità
│   ├── sources/         indice ufficiale, biblioteca di link e PDF, ricerca
│   ├── workflow/        vocabolario degli stati di esecuzione
│   ├── utils/           utilità trasversali
│   └── env.ts           validazione delle variabili di ambiente
└── proxy.ts             rinnovo sessione e protezione rotte (ex middleware.ts)
```

Dettaglio completo in [`docs/architecture.md`](docs/architecture.md).

---

## Configurazione locale

### Prerequisiti

- Node.js ≥ 20.9 (consigliato 22, vedi `.nvmrc`)
- npm 10+
- Un progetto Supabase (piano gratuito sufficiente)

### Passi

```bash
git clone https://github.com/DanielMeloni/AI-Editorial-Factory.git
cd AI-Editorial-Factory/ai-editorial-factory

npm install
cp .env.example .env.local   # poi compila i valori
npm run dev
```

L'applicazione risponde su http://localhost:3000 e reindirizza a `/login`.

---

## Configurazione Supabase

Da eseguire una sola volta, nel dashboard del progetto.

1. **Crea il progetto** su [supabase.com/dashboard](https://supabase.com/dashboard).
2. **Recupera le chiavi** in *Project Settings → API Keys*:
   - *Project URL* → `NEXT_PUBLIC_SUPABASE_URL`
   - *Publishable key* (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - *Secret key* (`sb_secret_…`) → `SUPABASE_SERVICE_ROLE_KEY` — **mai** nel browser
3. **Autenticazione** in *Authentication → Sign In / Providers → Email*:
   - abilita *Email*
   - lascia attivo *Confirm email* (la registrazione invia un link di conferma)
   - imposta la lunghezza minima password a 10 caratteri, per allinearla alla validazione dell'app
4. **URL di reindirizzo** in *Authentication → URL Configuration*:
   - *Site URL*: `http://localhost:3000` in sviluppo, l'URL di produzione su Vercel
   - *Redirect URLs*: aggiungi `http://localhost:3000/auth/callback` e
     `https://<dominio-di-produzione>/auth/callback`

Migration, bucket di storage e Row Level Security arrivano nella **Fase 2**.
Finché non esistono tabelle applicative, nessun dato editoriale viene scritto.

---

## Variabili di ambiente

Elenco completo e commentato in [`.env.example`](.env.example).

| Variabile | Obbligatoria | Dove trovarla |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | sì | URL dell'app (locale o produzione) |
| `NEXT_PUBLIC_SUPABASE_URL` | sì | Supabase → Project Settings → API Keys |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | sì | idem |
| `SUPABASE_SERVICE_ROLE_KEY` | dalla Fase 2 | idem — riservata al server |
| `AI_TEXT_PROVIDER` / `AI_TEXT_MODEL` | no (default `mock`) | — |
| `AI_IMAGE_PROVIDER` / `AI_IMAGE_MODEL` | no (default `mock`) | — |
| `AI_SEARCH_PROVIDER` / `AI_SEARCH_MODEL` | no (default `mock`) | `mock` non cerca e non inventa; `gemini`, `anthropic` o `openai` cercano davvero |
| `GEMINI_API_KEY` | solo se provider `gemini` | aistudio.google.com/apikey — quota di ricerca gratuita |
| `OPENAI_API_KEY` | solo se provider `openai` | platform.openai.com/api-keys |
| `ANTHROPIC_API_KEY` | solo se provider `anthropic` | console.anthropic.com/settings/keys |

La validazione è **pigra**: `next build` non fallisce su una macchina priva di segreti,
ma la prima richiesta reale produce un errore esplicito con l'elenco dei campi mancanti.

---

## Comandi

| Comando | Effetto |
|---|---|
| `npm run dev` | Server di sviluppo |
| `npm run build` | Build di produzione |
| `npm run start` | Avvia la build |
| `npm run lint` | ESLint su tutto il progetto |
| `npm run typecheck` | `tsc --noEmit` in modalità strict |
| `npm test` | Test unitari e di schema (Vitest) |
| `npm run test:smoke` | Collaudo HTTP contro la build di produzione |
| `npm run test:e2e` | Test end-to-end (Playwright) |
| `npm run check:env` | Verifica la configurazione senza stampare segreti |
| `npm run db:bundle` | Rigenera `supabase/setup-completo.sql` |
| `npm run sources:refresh` | Confronta l'indice delle fonti con le sitemap ufficiali |
| `npm run format` | Prettier |
| `npm run db:*` | Comandi Supabase CLI (dalla Fase 2) |

---

## Test

- **Unitari** (`tests/unit/`): validazioni Zod, mappa delle rotte, protezione dai redirect
  esterni, vocabolario degli stati, validazione delle variabili di ambiente.
- **End-to-end** (`tests/e2e/`): redirect delle rotte protette e usabilità del form di accesso.
  Richiedono l'app in esecuzione; Playwright la avvia automaticamente in locale.
- **RLS**: suite SQL dedicata nella Fase 2, con esecuzione documentata a parte
  (richiede Docker e Supabase in locale).

Il **provider AI mock** — attivo per impostazione predefinita — consente di percorrere
l'intero flusso senza consumare crediti.

---

## Deployment su Vercel

1. Collega il repository GitHub a un nuovo progetto Vercel.
2. **Root Directory**: `./` — il repository ha già la radice corretta.
3. Framework: Next.js (rilevato automaticamente).
4. Configura le variabili di ambiente in *Settings → Environment Variables*.
   `SUPABASE_SERVICE_ROLE_KEY` **senza** prefisso `NEXT_PUBLIC_`.
5. Allinea `NEXT_PUBLIC_APP_URL` al dominio di produzione e aggiungi
   `https://<dominio>/auth/callback` fra i Redirect URLs di Supabase.

Il deploy non viene mai eseguito automaticamente senza approvazione esplicita.
Dettagli in [`docs/deployment.md`](docs/deployment.md) (Fase 7).

---

## Risoluzione dei problemi

| Sintomo | Causa e rimedio |
|---|---|
| `Configurazione pubblica non valida` | Manca o è errata una variabile `NEXT_PUBLIC_*` in `.env.local` |
| Il login riesce ma torna a `/login` | *Redirect URLs* di Supabase non allineati a `NEXT_PUBLIC_APP_URL` |
| «Credenziali non valide» dopo la registrazione | Email non ancora confermata: apri il link ricevuto |
| Link di reset scaduto | I link Supabase durano circa un'ora: richiedine uno nuovo |
| `Unable to create index.lock` | Operazione Git interrotta: rimuovi `.git/index.lock` con Git chiuso |
| Lint in errore dopo un aggiornamento | Verifica che ESLint resti sulla 9.x (vedi nota sullo stack) |

---

## Documentazione

| Documento | Contenuto |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Struttura, flusso di autenticazione, decisioni tecniche |
| [`docs/database.md`](docs/database.md) | Schema, enum, RLS, indici, test su PostgreSQL reale |
| [`docs/agents.md`](docs/agents.md) | I dodici agenti, contratti Zod, indice delle fonti, tracciamento |
| [`docs/workflows.md`](docs/workflows.md) | Workflow durevole del Capitolo 11, gate di approvazione, revisione |
| [`docs/visual.md`](docs/visual.md) | Diagrammi, adapter visuale, calcolo del dorso, codice a barre |
| [`docs/publishing.md`](docs/publishing.md) | Markdown, HTML, PDF, lezione, articolo, download firmati |
| [`docs/series.md`](docs/series.md) | **Fase 8**: collane, ereditarietà, coerenza multi-volume |
| [`docs/security.md`](docs/security.md) | Controlli attivi, con i test che li verificano |
| [`docs/deployment.md`](docs/deployment.md) | Vercel, variabili, elenco di controllo, rollback |
| [`docs/dataform-pilot.md`](docs/dataform-pilot.md) | Struttura del volume pilota e mappatura editoriale |

---

## Che cosa fa, in concreto

1. **Registrazione e accesso** — sessione SSR, rotte protette, recupero password.
2. **Progetto editoriale** — un'opera con autore, volume, lingua.
3. **Caricamento dell'archivio** — lo ZIP va direttamente allo storage privato,
   con verifica dei percorsi contro path traversal e zip bomb.
4. **Struttura riconosciuta** — parti, capitoli e appendici ordinati **per
   numero**, non alfabeticamente. Il file indice viene confrontato con le
   cartelle reali e ogni differenza è segnalata.
5. **Audit tecnico** — analisi deterministica di SQLX, SQL e JavaScript;
   affermazioni verificabili senza fonte; autorevolezza dei riferimenti.
6. **Ricerca automatica delle fonti** — per ogni affermazione priva di rimando,
   l'indice curato della documentazione ufficiale propone la pagina che la
   sostiene, con i termini che hanno prodotto l'aggancio. Quando non ha nulla di
   pertinente lo dichiara: non ripiega su una fonte qualsiasi. Le fonti trovate
   compaiono nella scheda **Fonti**, dove si accettano o si scartano una per una.
7. **Biblioteca del progetto** — link e PDF aggiunti a mano vengono indicizzati
   (un PDF pagina per pagina) e la ricerca li propone accanto alla documentazione,
   con l'origine sempre dichiarata e il numero di pagina.
8. **Ricerca sul web** — l'AI cerca materiale di riferimento per il manuale e
   mostra quello che ritiene utile, con il motivo di ogni scelta. Ogni indirizzo
   viene **aperto prima di comparire**: chi non risponde non entra nell'elenco.
9. **Proposta di revisione** — una **nuova versione**, mai una sovrascrittura.
10. **Revisione umana** — confronto per righe e per parole, approvazione anche
   **parziale**, modifica manuale, commenti, ripristino.
11. **Diagrammi** — generati dal codice, esatti per costruzione.
12. **Copertina** — fronte, dorso e quarta, con dorso calcolato secondo la formula
   del fornitore di stampa e codice a barre EAN-13 validato.
13. **Pubblicazione** — Markdown, HTML sanificato, PDF, lezione e articolo, con
    download da collegamento firmato.

Nessun contenuto viene pubblicato senza approvazione umana. Il testo originale
non viene mai modificato.

---

## Verifica

```
npm run lint       0 errori
npm run typecheck  0 errori
npm test           469 test su 30 file
npm run build      26 rotte
npm run test:smoke 22 controlli HTTP su build di produzione
```

I test dello schema e della Row Level Security girano su **PostgreSQL reale**
(PGlite, PostgreSQL 18 in WebAssembly): non richiedono Docker e applicano le
migration vere, nell'ordine vero.

---

## Licenza

Progetto privato. Tutti i diritti riservati a Daniel Meloni.
