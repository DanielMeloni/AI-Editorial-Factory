# Architettura

> Stato: aggiornato alla **Fase 7**. Le sezioni marcate *(Fase 8)* descrivono
> decisioni già prese e fondamenta già presenti, ma funzionalità non ancora
> implementate.

## 1. Forma dell'applicazione

Monolite modulare Next.js con App Router. Nessun microservizio nell'MVP: la
durabilità dei processi lunghi non viene ottenuta separando i servizi, ma
delegando l'esecuzione a workflow durevoli *(Fase 3)*.

Tre livelli, con una regola di dipendenza unidirezionale:

```
app/ (rotte, Server Component, Server Action)
  ↓ dipende da
lib/ (dominio: validazione, guardie, contratti degli agenti)
  ↓ dipende da
lib/supabase, lib/ai (infrastruttura: SDK esterni)
```

Il dominio non importa mai direttamente un SDK di provider AI: passa da
un'interfaccia comune *(Fase 3)*. Questo rende i provider sostituibili e
consente il provider mock.

## 2. Struttura delle cartelle

| Percorso | Responsabilità |
|---|---|
| `src/app/(auth)/` | Pagine pubbliche. Layout centrato, senza sidebar |
| `src/app/(app)/` | Area privata. Layout con sidebar; verifica la sessione |
| `src/app/auth/callback/` | Scambia il codice email con una sessione (PKCE) |
| `src/components/ui/` | Primitive senza logica di dominio |
| `src/components/layout/` | Sidebar, topbar, breadcrumb, logo |
| `src/components/auth/` | Form collegati alle Server Action |
| `src/lib/auth/` | Guardie, schemi Zod, azioni, mappa delle rotte |
| `src/lib/supabase/` | Quattro client distinti, un ruolo ciascuno |
| `src/lib/workflow/` | Vocabolario degli stati, condiviso con gli enum PostgreSQL |
| `src/proxy.ts` | Rinnovo sessione e redirect (in Next 16 sostituisce `middleware.ts`) |

## 3. I quattro client Supabase

Distinzione deliberata: ogni client ha un solo contesto legittimo.

| File | Contesto | Chiave | Note |
|---|---|---|---|
| `client.ts` | Browser | publishable | Nessun segreto nel bundle |
| `server.ts` | Server Component, Action, Route Handler | publishable | Sessione da cookie; RLS attiva |
| `proxy.ts` | Proxy di rete | publishable | Unico punto che scrive i cookie di sessione |
| `admin.ts` | Step dei workflow *(Fase 3)* | **service role** | Ignora la RLS: uso ristretto e sorvegliato |

`admin.ts` importa `server-only`: qualsiasi tentativo di includerlo in un bundle
client fa fallire la build. Ogni sua chiamata dovrà essere preceduta da un
controllo esplicito di appartenenza all'organizzazione *(Fase 2)*.

## 4. Flusso di autenticazione

```
Richiesta
   │
   ├─▶ proxy.ts ──▶ updateSession()
   │                  ├─ getClaims(): verifica la firma del JWT
   │                  ├─ rinnova il token e riscrive i cookie
   │                  ├─ non autenticato + rotta privata → /login?redirectTo=…
   │                  └─ autenticato + /login o /register → /dashboard
   │
   └─▶ Server Component ──▶ requireUser() ──▶ getClaims()
                                              (seconda verifica, sul dato)
```

Due decisioni rilevanti:

- **Mai `getSession()` lato server.** Legge i cookie senza verificarne la firma:
  un cookie contraffatto verrebbe accettato. `getClaims()` valida il JWT contro
  le chiavi pubbliche pubblicate dal progetto.
- **Doppia verifica.** Il proxy è un filtro di navigazione, non
  un'autorizzazione. L'autorizzazione va riverificata dove i dati vengono
  effettivamente letti o scritti — è l'unico punto che conta.

Il parametro `redirectTo` passa da `safeRedirectTarget()`, che accetta solo
percorsi relativi: `https://…` e `//…` vengono scartati (open redirect).

## 5. Il proxy e il Workflow SDK

`src/proxy.ts` esclude `.well-known/workflow/` dal matcher. Il Workflow SDK usa
quel percorso per la propria coda interna; intercettarlo produce l'errore
`Queue operation failed` con un `ArrayBuffer` distaccato. L'esclusione è già
presente in Fase 1, prima dell'introduzione dei workflow, per evitare una
regressione difficile da diagnosticare in seguito.

## 6. Server Action invece di chiamate dal browser

Login, registrazione, reset e aggiornamento profilo passano da Server Action, non
dal client Supabase nel browser. Tre conseguenze:

- l'input è validato con Zod **sul server**, dove la validazione conta;
- le pagine restano prerenderizzabili: nessuna variabile di ambiente viene letta
  durante la build;
- i messaggi di errore sono deliberatamente generici e non rivelano se un
  indirizzo email è registrato.

Un file `"use server"` può esportare soltanto funzioni asincrone: per questo
`ActionState`, `initialActionState` e `toFieldErrors` vivono in
`lib/auth/action-state.ts`, importabile da entrambi i lati.

## 7. Design system

Tailwind v4 con configurazione CSS-first: nessun `tailwind.config.js`, i token
sono dichiarati in `@theme` dentro `globals.css`.

- **Palette base**: `navy` (superfici editoriali), `blue-electric` (azione
  primaria), `teal` (accento e stati AI), più i grigi neutri di Tailwind.
- **Token semantici** (`--background`, `--surface`, `--primary`, `--danger`, …):
  un solo nome, due valori. Il tema scuro riassegna le variabili; i componenti
  non contengono mai condizioni sul tema.
- **Tema**: `next-themes` con strategia a classe. L'interruttore mantiene
  entrambe le icone nel DOM e le alterna via CSS, evitando il flag `mounted` e
  il disallineamento di idratazione.
- **Accessibilità**: skip link, `:focus-visible` uniforme, `aria-describedby`
  generato dal componente `Field`, errori annunciati con `role="alert"`,
  rispetto di `prefers-reduced-motion`.

## 8. Stati di esecuzione

`lib/workflow/status.ts` definisce i sette stati previsti — in coda, in
esecuzione, in attesa di approvazione, completato, completato con avvisi,
fallito, annullato — con etichetta italiana e tono cromatico. Gli stessi valori
diventeranno enum PostgreSQL nella Fase 2: un unico vocabolario condiviso fra
database, dominio e interfaccia.

## 9. Funzioni non ancora disponibili

Le voci di menu non implementate restano visibili ma disattivate, con
`aria-disabled`, un badge «Presto» e il testo «Disponibile prossimamente» per gli
screen reader. Il tipo `NavItem` è una unione discriminata: una voce
`available: true` deve puntare a una rotta realmente esistente, verificata da
`typedRoutes` in fase di compilazione. Una voce disattivata non può essere
trasformata in link per errore.

## 10. Decisioni tecniche e motivazioni

| Decisione | Motivo |
|---|---|
| TypeScript 5.9.3 anziché 7.0.2 | `typescript-eslint@8` dichiara peer `<6.1.0` |
| ESLint 9.39.5 anziché 10.x | `eslint-plugin-react` in `eslint-config-next@16` usa `context.getFilename()`, rimosso in ESLint 10 |
| Workflow SDK `workflow` 4.8.1 | Pacchetto ufficiale (non `@vercel/workflow`); la 5.x beta serve solo per il multi-region |
| Font di sistema | Nessuna dipendenza di rete in fase di build; sostituibile in Fase 7 |
| Validazione env pigra | La build non deve richiedere segreti |
| Upload ZIP diretto a Storage *(Fase 2)* | Le Vercel Function accettano al massimo 4,5 MB di body |
| Estrazione ZIP come workflow *(Fase 2)* | Centinaia di file più hashing eccedono il timeout di una singola invocazione |
| Mermaid renderizzato nel browser *(Fase 5)* | `mermaid-cli` richiede Chromium: incompatibile con il bundle serverless |
| PDF con `@react-pdf/renderer` *(Fase 6)* | Puro JavaScript, nessun binario nel bundle |


---

## 11. Collane editoriali *(Fase 8)*

Un'opera non vive da sola: `Google Cloud in Pratica` è una collana di cui
`Dataform in Pratica` è il primo volume. La Fase 8 introduce il livello che
governa la coerenza fra volumi. Progetto completo in
[`docs/series.md`](series.md).

### Dove si innesta

```
organizations
   ├──< series ──< series_volumes >── projects        (0..1 su entrambi i lati)
   │                     │
   │                     ├──< series_rule_overrides
   │                     ├──< series_release_plans
   │                     └──< cross_volume_references
   │
   ├──< series_style_versions ──< series_rules
   ├──< series_shared_contents ──< series_shared_content_versions
   ├──< series_terms · series_assets · series_cover_templates
   └──< series_change_proposals ──< series_change_impacts
```

La collana **non** sostituisce il progetto: lo affianca. Un progetto continua a
funzionare senza collana, esattamente come oggi.

### La decisione di modellazione

`projects` non riceve `series_id` né `volume_number`: la fonte di verità è
`series_volumes`.

Un volume può esistere senza progetto — «Volume 4, previsto per l'autunno» è un
elemento di piano prima che di redazione — e un progetto può esistere senza
collana. La relazione è opzionale su entrambi i lati, e ha attributi propri:
data prevista, edizione, ISBN, dipendenze, deroghe. È un'entità, non una
colonna.

Duplicare il legame su `projects` creerebbe due percorsi verso la stessa verità,
destinati prima o poi a divergere senza che alcun vincolo se ne accorga. Il
prezzo della scelta è un join in più per risalire dalla collana al progetto.

### I due invarianti

**I volumi pubblicati non cambiano in silenzio.** Una copia stampata non si
aggiorna. Una modifica alla linea editoriale si applica ai volumi non
pubblicati; per quelli pubblicati genera una proposta separata che, se accettata,
produce una **nuova edizione**. È l'immutabilità del capitolo originale portata
al livello della collana, e il database la impone con un trigger.

**Una deroga è dichiarata e motivata.** Ogni regola vive nel volume come
`inherited`, `overridden` o `locked`. Una deroga senza motivazione è rifiutata
da un vincolo; una deroga su regola `locked` è rifiutata da un trigger. La
differenza fra una scelta editoriale e una svista deve restare leggibile fra due
anni.

### Che cosa esiste oggi

Migration 13 con le diciassette tabelle, RLS e vincoli; i modelli di dominio in
`src/lib/series/`; la funzione `resolveRule()` con i suoi test. Non esistono
rotte, agenti, workflow né esportazioni di collana: arrivano con la Fase 8.

---

## 12. Roadmap

| Fase | Contenuto | Stato |
|---|---|---|
| 0 | Analisi del repository e piano | completata |
| 1 | Fondazioni, design system, autenticazione | completata |
| 2 | Database, RLS, storage, importazione ZIP | completata |
| 3 | Provider AI, agenti, workflow durevoli | completata |
| 4 | Revisione umana, diff, approvazione parziale | completata |
| 5 | Diagrammi, adapter visuale, Cover Studio | completata |
| 6 | Markdown, HTML, PDF, lezione, articolo | completata |
| 7 | QA, sicurezza, accessibilità, deployment | completata |
| **8** | **Collane editoriali e coerenza multi-volume** | **fondamenta presenti** |
