# Workflow

> Stato: **Fase 3**. Il workflow di audit del Capitolo 11 è operativo, gate di
> approvazione umana compreso.

## 1. Il pacchetto

Il pacchetto è **`workflow`** (Workflow SDK di Vercel), non `@vercel/workflow` —
che su npm non esiste. Versione adottata: **4.8.1**, l'ultima stabile. La linea
5.x beta serve solo al pinning multi-regione, che qui non occorre.

```ts
// next.config.ts
export default withWorkflow(nextConfig);
```

La build genera tre rotte interne:

```
/.well-known/workflow/v1/flow
/.well-known/workflow/v1/step
/.well-known/workflow/v1/webhook/[token]
```

`src/proxy.ts` **esclude** `.well-known/workflow/` dal matcher fin dalla Fase 1.
Senza quell'esclusione la coda interna fallisce con
`Queue operation failed` e un `ArrayBuffer` distaccato — un errore silenzioso e
difficile da diagnosticare, particolarmente facile da introdurre in Next 16 dove
`proxy.ts` ha sostituito `middleware.ts`.

## 2. Perché durevole

Un audit tecnico dura minuti; l'approvazione umana può durare giorni. Un
processo in memoria non regge né l'uno né l'altro.

Con `'use workflow'` e `'use step'`, ogni passaggio viene registrato in un log di
eventi. Il workflow:

- **sopravvive** a un riavvio, a un errore e a un nuovo deploy;
- **si sospende** senza consumare risorse in attesa della decisione umana;
- **riprende** esattamente dal punto in cui si era fermato;
- **ignora** la chiusura del browser: lo stato non vive nella sessione.

## 3. I tredici passaggi

| # | Passaggio | Che cosa fa |
|---|---|---|
| 1 | `caricamento-capitolo` | Legge capitolo e ultima versione; verifica l'appartenenza all'organizzazione |
| 2 | — | Estrae titoli, codice, collegamenti, figure, segnaposto |
| 3 | `verifica-tecnica` | Analizza SQLX/SQL/JS e individua le affermazioni verificabili |
| 4 | `verifica-fonti` | Valuta i riferimenti citati |
| 5 | — | Individua le dipendenze `ref()` |
| 6 | `salvataggio-audit` | Scrive `verification_issues` e `citations` |
| 7 | `proposta-revisione` | Crea una **nuova** `chapter_version` (`ai_proposal`) |
| 8 | `piano-visuale` | Decide quali figure servono |
| 9 | `generazione-diagrammi` | Genera il DAG Mermaid dalle dipendenze |
| 10 | `richiesta-approvazione` | Crea la `review_request` con il token di ripresa |
| 11 | `attesa-approvazione` | **Sospensione**: nessuna risorsa consumata |
| 12 | — | Ripresa alla decisione umana |
| 13 | `salvataggio-versione` | Se approvata, la proposta diventa la versione corrente |

Il passaggio 14 — Markdown, HTML, PDF, lezione, articolo — appartiene alla
**Fase 6**. L'esito riporta `outputsPending: true`: non viene prodotto nulla né
dichiarato pronto.

## 4. Il gate di approvazione

```ts
export const approvalHook = defineHook<{
  decision: 'approved' | 'rejected' | 'changes_requested';
  note?: string;
  decidedBy?: string;
}>();
```

Il workflow crea il canale con un token opaco e vi si mette in ascolto. La
decisione lo riprende:

```ts
await approvalHook.resume(resumeToken, { decision, note, decidedBy });
```

**Nessun agente oltrepassa questo punto da solo.** L'approvazione è l'unico modo
per far diventare corrente una versione proposta.

## 5. Comandi

| Comando | Effetto |
|---|---|
| **Avvio** | Verifica l'autorizzazione con la sessione utente, crea `workflow_runs`, avvia l'esecuzione con `start()` |
| **Osservazione** | Timeline con stato, passaggio corrente, provider, modello, durata, token, costo, confidenza, avvisi |
| **Annullamento** | Cooperativo: il motore non spezza uno step a metà. Il run viene marcato e non prosegue oltre il gate |
| **Ritentativo** | Solo da stato fallito o annullato; avvia una nuova esecuzione sullo stesso capitolo |
| **Ripresa** | Solo tramite decisione umana sulla `review_request` |

Un solo audit alla volta per capitolo: due esecuzioni parallele produrrebbero
due proposte concorrenti sulla stessa base.

## 6. Autorizzazione

Gli step girano **senza sessione utente**: usano il service role, che ignora la
RLS. Due contromisure:

1. L'autorizzazione avviene **prima**, all'avvio, con la sessione dell'utente e
   la RLS attiva. Il workflow riceve `organizationId` e `projectId` già
   verificati.
2. Il primo step **riverifica** che il capitolo appartenga davvero a quel
   progetto e a quella organizzazione, e fallisce altrimenti.

Il service role resta confinato a `src/lib/supabase/admin.ts`, che importa
`server-only`.

## 7. Stati

Sette stati, un solo vocabolario condiviso fra enum PostgreSQL, dominio
TypeScript e interfaccia:

`queued` · `running` · `awaiting_approval` · `completed` ·
`completed_with_warnings` · `failed` · `cancelled`

Un audit che rileva problemi **critici** termina in
`completed_with_warnings`: è riuscito, ma non va considerato pulito.

## 8. Osservabilità

`external_run_id` collega la riga di `workflow_runs` all'esecuzione nel
cruscotto Vercel (*Observability → Workflows*), dove sono visibili input,
output, sleep ed errori di ogni step.

## 9. Sviluppo in locale

```bash
npm run dev
npx workflow web        # interfaccia di ispezione delle esecuzioni
npx workflow inspect runs
```

Con `AI_TEXT_PROVIDER=mock` — l'impostazione predefinita — il workflow gira per
intero senza consumare crediti, e l'audit prodotto è reale.

## 10. Limite noto

L'estrazione dello ZIP (Fase 2) è ancora una Route Handler con
`maxDuration = 300`, non uno step di workflow. `extractArchive()` è già una
funzione pura proprio perché quel passaggio sia una sostituzione di chiamante e
non una riscrittura.

---

## 11. La revisione umana (Fase 4)

### Approvazione parziale

Il confronto fra la versione di partenza e la proposta è raggruppato in
**blocchi indipendenti**. Il revisore può accettarne alcuni e non altri.

La ricomposizione (`applySelectedHunks`) deve essere esatta, altrimenti si
salverebbe un testo che nessuno ha mai letto. Due proprietà sono verificate dai
test su ogni forma di modifica — sostituzione, rimozione, inserimento in testa,
inserimento in coda, documenti vuoti:

- con **tutti** i blocchi selezionati il risultato è **identico** alla proposta;
- con **nessun** blocco selezionato è **identico** all'originale.

Un ulteriore test percorre **tutti i sottoinsiemi possibili** di blocchi e
verifica che nessuno perda righe di contesto.

### Che cosa succede a ogni azione

| Azione | Effetto |
|---|---|
| **Approva tutto** | La proposta diventa la versione corrente |
| **Approva una selezione** | Viene creata una nuova versione `human_edit` con i soli blocchi accettati, e approvata |
| **Modifica manuale** | Il testo modificato diventa una nuova versione `human_edit`, poi approvabile |
| **Richiedi modifiche** | Richiede una motivazione: senza, l'azione è rifiutata |
| **Rifiuta** | Nessuna versione diventa corrente; il capitolo torna in bozza |
| **Ripristina versione** | Sposta il puntatore `current_version_id`. **Non cancella nulla** |
| **Commenta** | Commento libero o ancorato a un blocco specifico |

In nessun caso l'originale viene toccato: è la versione 1, `origin =
'original'`, protetta da trigger nel database.

### Il momento della lettura conta

Lo step `applyDecision` **rilegge** `proposed_version_id` dal database invece di
usare il valore catturato all'apertura della richiesta. Fra i due istanti il
revisore può aver accettato solo alcune modifiche o essere intervenuto a mano,
generando una versione diversa: approvare quella vecchia significherebbe
scartare silenziosamente il suo lavoro.
