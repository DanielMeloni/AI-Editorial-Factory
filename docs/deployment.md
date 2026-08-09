# Deployment

> Stato: **Fase 7**. Nessun deploy viene mai eseguito senza approvazione
> esplicita del proprietario del progetto.

## 1. Prima di collegare Vercel

Tre cose devono essere già a posto:

1. **Schema applicato** su un progetto Supabase — `npx supabase db push`, oppure
   `supabase/setup-completo.sql` dall'SQL Editor.
2. **Autenticazione configurata**: provider Email attivo, conferma email attiva,
   lunghezza minima password a 10 caratteri.
3. **Build locale pulita**: `npm run lint && npm run typecheck && npm test && npm run build`.

## 2. Collegamento del progetto

| Impostazione | Valore |
|---|---|
| Framework Preset | Next.js (rilevato) |
| **Root Directory** | `./` |
| Build Command | `npm run build` (predefinito) |
| Install Command | `npm install` (predefinito) |
| Node.js Version | 22.x |

La Root Directory resta `./` perché il repository ha già la radice
corretta: `ai-editorial-factory/` **è** la radice del repository.

## 3. Variabili di ambiente

*Settings → Environment Variables*. Ogni variabile va impostata per gli ambienti
in cui serve (Production, Preview, Development).

| Variabile | Ambiente | Esposta al browser |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | tutti | sì — il dominio dell'ambiente |
| `NEXT_PUBLIC_SUPABASE_URL` | tutti | sì |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | tutti | sì |
| `SUPABASE_SERVICE_ROLE_KEY` | tutti | **no** |
| `AI_TEXT_PROVIDER`, `AI_TEXT_MODEL` | tutti | no |
| `AI_IMAGE_PROVIDER`, `AI_IMAGE_MODEL` | tutti | no |
| `OPENAI_API_KEY` | solo se il provider è OpenAI | **no** |
| `ANTHROPIC_API_KEY` | solo se il provider è Anthropic | **no** |

`SUPABASE_SERVICE_ROLE_KEY` **non deve mai** avere il prefisso `NEXT_PUBLIC_`:
ignora la Row Level Security, e nel browser annullerebbe l'intero isolamento fra
organizzazioni.

`NEXT_PUBLIC_APP_URL` va aggiornata per ciascun ambiente: è l'origine usata nei
link inviati via email. Con un valore sbagliato, la conferma della registrazione
porta al dominio errato.

Per iniziare senza spendere, lascia `AI_TEXT_PROVIDER=mock` e
`AI_IMAGE_PROVIDER=mock`: il flusso è percorribile per intero e l'audit prodotto
è reale.

## 4. Supabase: URL di reindirizzo

*Authentication → URL Configuration*:

- **Site URL**: il dominio di produzione
- **Redirect URLs**: aggiungi tutte le origini da cui può partire un accesso
  ```
  https://<dominio-produzione>/auth/callback
  https://*.vercel.app/auth/callback       ← anteprime
  http://localhost:3000/auth/callback      ← sviluppo
  ```

Senza queste voci l'accesso riesce ma il ritorno all'applicazione fallisce.

## 5. Workflow

Il Workflow SDK non richiede configurazione su Vercel: le rotte
`/.well-known/workflow/v1/*` vengono generate dalla build e la piattaforma le
riconosce.

Due verifiche dopo il primo deploy:

1. **Fluid Compute attivo** (*Settings → Functions*). I workflow sospesi non
   consumano risorse solo con questo modello di esecuzione.
2. **Il proxy non intercetta le rotte interne.** `src/proxy.ts` esclude già
   `.well-known/workflow/`; `npm run test:smoke` lo verifica. Se un giorno il
   matcher venisse modificato, i workflow fallirebbero con
   `Queue operation failed` e un `ArrayBuffer` distaccato — un errore silenzioso
   e difficile da ricondurre alla causa.

Le esecuzioni si osservano in *Observability → Workflows*. La colonna
`external_run_id` di `workflow_runs` corrisponde all'identificativo mostrato lì.

## 6. Durate massime

| Rotta | `maxDuration` | Motivo |
|---|---|---|
| `/api/projects/…/ingest` | 300 s | Estrazione ZIP, hashing, catalogazione |
| Step dei workflow | predefinita | Ogni step è breve; la durata la gestisce il motore |

Sul piano Hobby il limite è inferiore: un archivio molto grande può eccedere il
tempo disponibile. L'errore viene registrato sulla fonte e l'importazione si può
ripetere.

## 7. Ambienti di anteprima

Ogni ramo produce un'anteprima. Attenzione: **le anteprime condividono il
database di produzione** se puntano allo stesso progetto Supabase.

Per un isolamento reale, crea un secondo progetto Supabase e assegna le sue
variabili all'ambiente Preview.

## 8. Verifiche dopo il deploy

```bash
# Intestazioni di sicurezza
curl -sI https://<dominio>/login | grep -iE 'content-security|x-frame|x-content-type|referrer'

# Le rotte private reindirizzano
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<dominio>/dashboard

# Nessuna indicizzazione
curl -s https://<dominio>/robots.txt
```

Localmente, contro la build di produzione, `npm run test:smoke` esegue 22
controlli sugli stessi aspetti:

```bash
npm run build        # obbligatorio: il collaudo avvia `npm start`
npm run test:smoke
```

Senza `.env.local` compilato, i cinque controlli sulla protezione delle rotte
vengono **saltati con motivo esplicito** anziche' falliti: il proxy non ha una
sessione da verificare, e un rosso che non dipende dal codice insegna solo a
ignorare i rossi.

## 9. Elenco di controllo

- [ ] Migration applicate; `pg_class` conferma RLS su tutte le tabelle
- [ ] Tre bucket privati esistenti, nessuno pubblico
- [ ] Provider Email attivo con conferma
- [ ] Redirect URLs allineati al dominio
- [ ] Variabili di ambiente impostate; `SUPABASE_SERVICE_ROLE_KEY` non pubblica
- [ ] Root Directory `./`
- [ ] Fluid Compute attivo
- [ ] Registrazione, accesso e logout funzionanti in produzione
- [ ] Caricamento di un archivio ZIP riuscito
- [ ] Un audit avviato, sospeso in attesa di approvazione e ripreso
- [ ] Un'esportazione scaricata tramite collegamento firmato
- [ ] `npm run test:smoke` contro la build di produzione: 22 controlli superati

## 10. Diagnosi dei problemi

| Sintomo | Causa |
|---|---|
| `Configurazione pubblica non valida` | Manca una `NEXT_PUBLIC_*` nell'ambiente |
| Accesso riuscito ma ritorno fallito | Redirect URL non registrato su Supabase |
| Link di conferma verso il dominio sbagliato | `NEXT_PUBLIC_APP_URL` non allineata all'ambiente |
| `Queue operation failed` | Il matcher del proxy intercetta `.well-known/workflow/` |
| Workflow avviato ma fermo in `queued` | Fluid Compute disattivo, oppure `start()` fallito |
| «SUPABASE_SERVICE_ROLE_KEY non configurata» | La chiave manca: gli step non possono scrivere |
| Estrazione ZIP interrotta | Durata massima superata: archivio troppo grande per il piano |
| Nessuna organizzazione per l'utente | Il trigger `on_auth_user_created` non è stato applicato |

## 11. Rollback

Vercel conserva i deploy precedenti: *Deployments → … → Promote to Production*
riporta la versione precedente in pochi secondi.

**Le migration non tornano indietro da sole.** Se un rilascio ne include una che
altera lo schema, il rollback del codice non basta: serve una migration
correttiva. Per questo le migration sono additive e non modificano quelle già
applicate.
