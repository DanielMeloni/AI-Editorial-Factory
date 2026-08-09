# Sicurezza

> Stato: **Fase 7**. Questo documento elenca ciò che è **attivo**, verificato da
> test eseguibili. Nulla è dichiarato attivo se non lo è.

## 1. Segreti

| Controllo | Come è garantito |
|---|---|
| Nessun segreto nel repository | `.env*` ignorati; `npm run check:env` fallisce se `.env.example` contiene valori reali |
| Nessun segreto nel bundle client | Solo `NEXT_PUBLIC_*` raggiunge il browser |
| Service role isolato | `src/lib/supabase/admin.ts` importa `server-only`: un import dal client rompe la build |
| Chiavi mai nei log | Gli errori riportano il nome della variabile, mai il valore |
| Scambi pericolosi intercettati | `check:env` riconosce una secret key finita in una variabile `NEXT_PUBLIC_` |

## 2. Autenticazione e sessione

- **`getClaims()`** ovunque: verifica la firma del JWT contro le chiavi pubbliche.
  `getSession()` non viene mai usata per autorizzare — legge i cookie senza
  validarli.
- **Doppia verifica**: il proxy filtra la navigazione, la guardia `requireUser()`
  riverifica dove i dati vengono effettivamente usati.
- **Open redirect impossibile**: `safeRedirectTarget()` accetta solo percorsi che
  iniziano con `/` e non con `//`.
- **Enumerazione degli account impedita**: accesso e recupero password
  restituiscono messaggi identici a prescindere dall'esistenza dell'indirizzo.
- **Password**: minimo 10 caratteri con maiuscola, minuscola e cifra; massimo 72
  (limite di bcrypt).

## 3. Isolamento fra organizzazioni

Row Level Security su **tutte** le 25 tabelle, con `ENABLE` **e** `FORCE`.
Il ruolo `anon` non ha alcun privilegio sui dati editoriali.

Verificato da 16 test che impersonano utenti reali su PostgreSQL:
un utente di un'altra organizzazione non vede, non modifica e non cancella
nulla; il client non può scrivere su `usage_events` né su `audit_log`; gli
oggetti di storage sono isolati dal primo segmento del percorso.

Gli step dei workflow usano il service role e **riverificano** l'appartenenza:
l'autorizzazione avviene prima, con la sessione utente e la RLS attiva.

## 4. Importazione degli archivi

| Difesa | Verificata da |
|---|---|
| Risalita `../` rifiutata, anche "bilanciata" | 5 test |
| Percorsi assoluti e unità Windows rifiutati | 4 test |
| Byte nulli e caratteri di controllo rifiutati | 2 test |
| Nomi riservati Windows (`CON`, `NUL`, `LPT1`…) rifiutati | 2 test |
| Limiti su voci, dimensione, profondità, lunghezza | 4 test |
| Rapporto di compressione oltre 200× (zip bomb) | 1 test |
| Firma `PK\x03\x04` controllata sui byte | — |
| Errore su un file annotato, non fatale | 1 test |

I file `.py`, `.js`, `.sql` e `.sqlx` sono trattati come **testo inerte**:
letti, analizzati, mostrati, **mai eseguiti**.

L'archivio non transita dal server applicativo: caricamento diretto su Storage
con URL firmato, perché una Vercel Function accetta al massimo circa 4,5 MB.

## 5. Contenuto generato

La sanitizzazione dell'HTML **non è opzionale**: il Markdown proviene da un
archivio caricato e può contenere qualsiasi cosa. Sette test verificano che
`<script>`, `onerror`, `<iframe>`, `javascript:` e `<style>` non sopravvivano
all'esportazione, e che i metadati contenenti HTML vengano neutralizzati.

Lo stesso vale per l'SVG della copertina: i testi passano da una funzione di
neutralizzazione XML.

## 6. Intestazioni HTTP

Verificate da `npm run test:smoke` contro un server di produzione reale:

| Intestazione | Valore |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; connessioni limitate a Supabase |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microfono, geolocalizzazione, topics disattivati |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `X-Powered-By` | assente |

**Compromesso dichiarato**: `script-src` include `'unsafe-inline'` e
`'unsafe-eval'` perché Next.js inietta gli script di idratazione senza nonce.
Una CSP con nonce richiede di rendere dinamica ogni pagina. È una scelta
consapevole, non una dimenticanza.

## 7. Limiti sulle operazioni AI

Per **organizzazione**, non per utente: è l'organizzazione a pagare.

| Operazione | Limite |
|---|---|
| Avvio di workflow | 20 all'ora |
| Generazione di immagini | 40 all'ora |
| Esportazioni | 60 all'ora |

Il conteggio legge le righe che l'operazione stessa produce: nessun contatore
separato che possa divergere dai fatti, e funziona su più istanze serverless,
che non condividono memoria.

Se la verifica del limite **fallisce**, l'operazione passa e l'errore viene
annotato: un limite che blocca per un guasto proprio è peggiore del rischio che
dovrebbe prevenire.

## 8. CSRF

Le Server Action di Next.js verificano l'origine e usano identificatori non
indovinabili: sono protette per costruzione. Le decisioni sulle revisioni
passano da Server Action, non da endpoint pubblici.

Il token di ripresa dei workflow è un UUID casuale, conservato in
`review_requests.resume_token` con vincolo di unicità.

## 9. Audit

`audit_log` registra: creazione progetti, ingestione archivi, avvio e
annullamento workflow, decisioni sulle revisioni, approvazioni parziali,
modifiche manuali, ripristini di versione, generazione e approvazione di asset,
pubblicazioni.

La tabella **non ha policy di INSERT**: il client non può scriverci per
costruzione. Solo il service role vi accede. Un audit non riuscito non fa mai
fallire l'operazione dell'utente.

## 10. Download

Nessun URL statico. I tre bucket sono privati; i collegamenti sono firmati e
scadono: 5 minuti per gli asset visuali, 2 minuti per le esportazioni. Il server
verifica l'appartenenza prima di emetterli.

Ogni esportazione registra dimensione e checksum SHA-256.

## 11. Non ancora implementato

Detto apertamente, per non lasciar credere il contrario:

- **Autenticazione a più fattori**: Supabase la supporta, l'applicazione non la
  espone ancora.
- **Rotazione automatica dei segreti**: manuale.
- **Scansione antivirus dei file caricati**: nessuna. I file non vengono
  eseguiti, ma nemmeno ispezionati.
- **CSP con nonce**: vedi il compromesso al punto 6.
- **Limiti di spesa in valuta**: i limiti sono sul numero di operazioni, non sul
  costo cumulato.

## 12. Segnalazioni

Vulnerabilità o dubbi: admin@danielmeloni.com. Non aprire issue pubbliche per
problemi di sicurezza.
