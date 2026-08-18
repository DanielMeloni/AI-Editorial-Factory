# Agenti

> Stato: **Fase 3**. Quattro agenti sono operativi sul workflow del Capitolo 11.
> Gli altri otto esistono nel catalogo del database ma sono dichiarati **non
> implementati**: l'interfaccia li mostra disattivati, mai come funzionanti.

## 1. Il principio

Gli agenti non si passano testo libero. Ogni esecuzione ha un **input e un
output validati con Zod**. Un output che viola il proprio schema è un errore di
esecuzione, non un risultato da interpretare a valle.

```ts
interface AgentDefinition<I, O> {
  key; name; version; promptVersion;
  inputSchema:  z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  system;  buildPrompt(input): string;
  deterministic?(input): O;   // implementazione senza modello
}
```

## 2. Deterministico prima, modello poi

`deterministic` non è un ripiego per i test: dove esiste, è l'implementazione
**preferita**.

Che una tabella dichiarata `type: "incremental"` non contenga né
`when(incremental(), …)` né `self()` è un fatto leggibile nel codice, non un
parere. Affidarlo a un modello significherebbe pagare per una risposta meno
affidabile di una lettura. Il modello serve dove il giudizio è necessario —
riformulare una spiegazione, valutare l'ordine didattico — non dove basta
guardare.

Conseguenza pratica: **in modalità mock il workflow produce un audit reale**, non
un risultato di comodo. Si sviluppa e si collauda l'intero flusso senza spendere
un centesimo, e ciò che si vede è ciò che si otterrà.

## 3. I quattro agenti operativi

### Technical Verifier

Analizza SQLX, SQL e JavaScript, e individua le affermazioni verificabili.

| Regola | Gravità | Che cosa rileva |
|---|---|---|
| `incrementale-senza-condizione` | alta | `type: "incremental"` senza `when(incremental(), …)` né `self()`: l'intero storico verrebbe rielaborato a ogni esecuzione |
| `incrementale-senza-unique-key` | media | Le righe aggiornate verrebbero duplicate invece che sostituite |
| `incrementale-senza-partizionamento` | bassa | Nessun `partitionBy`: costo di scansione elevato su tabelle grandi |
| `riferimento-non-dichiarato` | alta | `\`progetto.dataset.tabella\`` invece di `ref()`: la dipendenza resta fuori dal grafo |
| `select-asterisco` | media | Lo schema dipende dalla sorgente: una colonna aggiunta a monte cambia l'output |
| `delete-senza-where` | **critica** | Cancellerebbe l'intera tabella |
| `sqlx-senza-config` | media | Dataform non saprebbe cosa creare |
| `blocco-senza-linguaggio` | bassa | Nessuna colorazione sintattica, tipo di codice ambiguo |
| `var-obsoleto`, `confronto-debole` | bassa | JavaScript |

Le **affermazioni verificabili** sono le frasi che un manuale deve poter
sostenere: quantificazioni («riduce del 90%»), assoluti («sempre», «mai»),
limiti («non supporta»), costi, comportamenti del prodotto. Ognuna viene
classificata e marcata come sostenuta o meno da una fonte.

### Source Auditor

Fa due cose: giudica le fonti che ci sono e **cerca quelle che mancano**.

**Le fonti presenti.** Distingue la documentazione ufficiale del produttore
(`cloud.google.com`, `docs.cloud.google.com`, `dataform.co`,
`developers.google.com`) dalle fonti della comunità (Stack Overflow, Medium).
Le seconde sono utili, ma non sostituiscono la prima quando l'affermazione
riguarda il comportamento del prodotto. Segnala i capitoli privi di qualsiasi
riferimento, gli URL non cifrati e — controllo aggiunto con la ricerca
automatica — i collegamenti su dominio ufficiale che l'indice non conosce: la
documentazione viene riorganizzata di continuo, e un collegamento morto è
peggio di uno assente.

**Le fonti mancanti.** Riceve dal Technical Verifier le affermazioni marcate
`hasSupportingSource: false` e, per ognuna, interroga l'indice curato. Quando
trova, propone fino a tre pagine con il punteggio e i **termini che hanno
prodotto l'aggancio**; quando non trova, lo dichiara e conta l'affermazione fra
le non risolte. Non ripiega mai su una fonte qualsiasi.

| Esito del riferimento | Significato |
|---|---|
| `ufficiale_indicizzata` | Dominio del produttore, pagina presente nell'indice |
| `ufficiale_non_indicizzata` | Dominio giusto, pagina che non risulta: da aprire |
| `comunita` | Utile, non autorevole |
| `sconosciuta` | Dominio non riconosciuto |
| `non_valida` | URL non interpretabile |

### L'indice curato delle fonti

La ricerca **non interroga il web aperto**: interroga un indice di pagine
ufficiali censite in `src/lib/sources/catalog.data.ts`. È una scelta, non un
limite tecnico.

| Proprietà | Conseguenza |
|---|---|
| Chiuso | Una fonte proposta esiste perché è stata censita, non perché è stata scritta in modo plausibile |
| Deterministico | Stesso capitolo, stesso indice, stesse proposte: verificabile in un test |
| Ufficiale per costruzione | Nell'indice entrano soltanto i domini del produttore |

Il prezzo è la copertura: ciò che non è nell'indice non viene proposto, e il
sistema lo dice invece di ripiegare su altro.

L'aggancio fra un manuale in italiano e una documentazione in inglese avviene
con un punteggio lessicale pesato per rarità del termine (IDF): «tabella»
compare in mezzo indice e vale poco, «partizionamento» in due pagine e vale
molto. Una sola parola in comune non basta a chiamare pertinente una pagina,
salvo che sia un termine molto raro **e** il punteggio sia nettamente sopra
soglia.

`npm run sources:refresh` confronta l'indice con le sitemap ufficiali e riporta
le pagine nuove e quelle non più pubblicate. Con `--write` aggiunge le nuove,
marcate da rivedere; **non rimuove nulla e non tocca i termini scritti a mano** —
sono la parte curata, ed è quella che fa funzionare l'aggancio.

Le proposte finiscono in `source_suggestions`, tabella distinta da `citations`:
una proposta non è una citazione finché un revisore non l'accetta.

### La biblioteca del progetto

L'indice ufficiale copre la documentazione del produttore. Un manuale però si
appoggia anche ad altro — una specifica, una norma, un articolo, un documento
interno — e dalla scheda **Fonti** quel materiale si aggiunge a mano: un
indirizzo, oppure un PDF caricato.

Non resta un elenco da consultare: viene **indicizzato**, e da quel momento la
ricerca automatica lo propone insieme alla documentazione. Un PDF viene letto
pagina per pagina, e il numero di pagina viaggia con il blocco fino alla
proposta — al revisore serve sapere *dove* guardare, non ricevere duecento
pagine e la parola «fidati».

| Aspetto | Come è trattato |
|---|---|
| Provenienza | `origin` è scritto su ogni proposta: `catalogo_ufficiale` o `biblioteca`. Una fonte caricata non viene mai spacciata per documentazione del produttore |
| Peso | Una fonte della biblioteca pesa 0,85 rispetto a 1 della documentazione — a meno che l'autore non la dichiari **autorevole** (una specifica, una norma), e allora vale quanto la fonte primaria |
| Ambito | Fonte del volume, oppure dell'organizzazione e quindi ereditata da tutti i progetti. È lo schema delle collane |
| Ordine | I candidati sono ordinati per pertinenza, **non** per provenienza: se una specifica caricata spiega l'affermazione meglio della documentazione, viene prima |

Documentazione e biblioteca finiscono in **un solo indice**, costruito insieme.
Non è un dettaglio: con due indici separati «0,8 nella biblioteca» e «0,8 nel
catalogo» non vorrebbero dire la stessa cosa, e il revisore si troverebbe
davanti classifiche non confrontabili.

Che cosa succede quando una fonte non è indicizzabile — una pagina che si
costruisce nel browser, un PDF che è una scansione — è dichiarato e non
nascosto: la fonte resta registrata e citabile a mano, con lo stato
«non indicizzata» e il motivo scritto accanto.

### La ricerca su richiesta

`Cerca fonti`, nella scheda Fonti, esegue la stessa ricerca dell'audit su tutti
i capitoli del progetto. Serve quando la biblioteca cambia: si carica una
specifica e si vuole sapere subito che cosa sostiene, senza rieseguire un audit
intero. Le proposte già accettate o scartate **non** vengono toccate: rifare la
ricerca non annulla il lavoro di chi ha già scelto.

### Technical Writer

Propone una revisione **senza toccare l'originale**: crea una nuova
`chapter_version` con `origin = 'ai_proposal'`.

Nella versione deterministica interviene solo dove non c'è nulla da
interpretare:

- dichiara il linguaggio dei blocchi di codice che non lo indicano, deducendolo
  dal contenuto;
- annota il testo alternativo mancante sulle immagini, marcandolo da rivedere;
- elenca **in coda** al documento le fonti ufficiali trovate per le affermazioni
  che ne erano prive, con l'URL già pronto da copiare, e separatamente quelle
  per cui l'indice non ha nulla — senza spezzare la lettura.

Il collegamento non viene inserito dentro la frase: dove collocare un rimando è
una scelta editoriale, e spetta al revisore.

Non riscrive frasi e non aggiunge contenuto tecnico: quello richiede un modello,
e comunque l'approvazione umana. `preservesMeaning` è parte del contratto.

### Visual Art Director

Decide quali figure servono. Se il capitolo dichiara dipendenze, il grafo è la
figura più utile — ed è esatta per costruzione. Ogni segnaposto lasciato
dall'autore diventa una voce del piano, classificata come diagramma o
illustrazione secondo ciò che descrive.

## 4. Gli otto agenti non ancora implementati

`ingestion`, `curriculum`, `teaching`, `technical_diagram`, `illustration`,
`cover`, `editorial_reviewer`, `publishing`.

Sono presenti in `agent_definitions` con `implemented = false`. L'architettura è
predisposta; il comportamento no. Nessuno di essi viene descritto come
funzionante.

## 5. Tracciamento

Ogni invocazione lascia una riga in `agent_runs`:

| Campo | Contenuto |
|---|---|
| `agent_key`, `agent_version`, `prompt_version` | Che cosa è stato eseguito |
| `provider`, `model` | `deterministic` + `agente@versione`, oppure provider e modello reali |
| `input_hash` | SHA-256 dell'input, con chiavi ordinate: stesso contenuto, stesso hash |
| `input`, `output` | Payload completi, validati |
| `status` | Vocabolario condiviso con i workflow |
| `duration_ms`, `started_at`, `finished_at` | Tempi |
| `input_tokens`, `output_tokens`, `estimated_cost_usd` | Contabilità |
| `confidence`, `warnings` | Qualità dichiarata |
| `error` | Messaggio e se sia il caso di ritentare |
| `attempt`, `workflow_run_id` | Tentativo e appartenenza |

Ogni esecuzione produce anche una riga in `usage_events`, **anche a costo zero**:
serve a distinguere «non ha speso» da «non è stato eseguito».

## 6. Provider

Il dominio non importa mai un SDK. Parla con `TextProvider` e `ImageProvider`.

| Provider | Stato | Note |
|---|---|---|
| `mock` (testo) | operativo | Non interpella alcun modello. Se un agente non ha implementazione deterministica, **fallisce esplicitamente** invece di inventare |
| `openai` (testo) | operativo | API HTTP diretta, modalità JSON, output validato |
| `anthropic` (testo) | operativo | Risposta precompilata con `{` per forzare il JSON |
| `mock` (immagini) | operativo | Genera un PNG reale, deterministico rispetto al prompt, senza testo dentro l'immagine |
| provider visuali reali | **Fase 5** | Non implementati |

Se un provider reale è configurato ma la chiave manca, si ricade sul mock **con
un avviso registrato**: preferibile un'esecuzione dichiaratamente simulata a
un'interruzione opaca.

## 7. Verifica

`npm test` copre: le regole di analisi Dataform una per una, il riconoscimento
delle affermazioni, la distinzione fra fonti ufficiali e della comunità,
l'integrità dell'indice (solo `https`, solo domini ufficiali, nessun doppione),
il fatto che ogni URL proposto provenga dall'indice, che una frase fuori tema
non produca proposte e che l'esito sia stabile a parità di testo,
l'additività della revisione (l'originale non viene mai perduto), la stabilità
dei diagrammi, la stabilità dell'hash rispetto all'ordine delle chiavi e la
validità del PNG prodotto dal mock.


---

## 9. Agenti di collana *(Fase 8, non implementati)*

Sei agenti operano sull'intera collana anziché sul singolo capitolo. Progetto
completo in [`docs/series.md`](series.md).

| Agente | Compito |
|---|---|
| **Series Architect** | Progetta struttura e roadmap della collana |
| **Series Curriculum** | Progressione della difficoltà, prerequisiti fra volumi, concetti usati prima di essere spiegati, lacune e sovrapposizioni |
| **Series Consistency** | Coerenza editoriale, terminologica, visiva, didattica e tecnica; distingue le differenze **autorizzate** da quelle non autorizzate |
| **Series Visual Director** | Identità visiva condivisa e differenze controllate fra volumi |
| **Cross-Volume Reference** | Riferimenti fra volumi e capitoli; segnala quando la destinazione cambia |
| **Series Publishing** | Catalogo, schede dei volumi, materiali promozionali |

Vale la stessa regola dei dodici agenti già previsti: **propongono, non
applicano**. Nessuno può modificare un volume senza approvazione umana, e nessuno
può toccare un volume pubblicato — per quello serve una nuova edizione.

Non sono presenti in `agent_definitions`: verranno registrati dalla migration
della Fase 8, con `implemented = false` finché non lo saranno davvero.

---

## 10. Ricerca di fonti sul web

L'indice curato risponde alla domanda «quale pagina sostiene questa
affermazione». La ricerca web risponde a un'altra: «su che cosa mi baso per
scrivere questo manuale». Il pulsante **Cerca fonti sul web**, nella scheda
Fonti, cerca materiale di riferimento e propone quello che ritiene utile.

Aprire il web reintroduce però il rischio che l'indice chiuso evitava: un
motore può riferire un indirizzo plausibile e inesistente, e in un manuale
tecnico l'errore si scopre in stampa. La difesa non sta nel prompt — sta nella
sequenza:

| Passaggio | Chi lo fa | Che cosa garantisce |
|---|---|---|
| 1 · Si formula | `buildQueries` | Poche interrogazioni mirate, ricavate da titolo e capitoli. Non una per capitolo: sarebbero decine di chiamate e un elenco illeggibile |
| 2 · Si cerca | `WebSearchProvider` | Restituisce indirizzi **grezzi e non verificati**: è ciò che un motore dichiara di aver trovato |
| 3 · Si verifica | `verifyUrl` | **Ogni indirizzo viene aperto.** Chi non risponde cade qui e non arriva sotto gli occhi di nessuno. Il titolo mostrato è quello letto dalla pagina |
| 4 · Si sceglie | `sourceDiscoveryAgent` | Seleziona fra ciò che è sopravvissuto, e motiva. Può solo scegliere, mai aggiungere |

Fra il terzo e il quarto passaggio c'è un controllo in più: la selezione viene
**ricondotta all'elenco verificato**. Se il modello restituisce un URL che non
gli era stato dato, quella voce viene scartata e il fatto viene riferito. Non è
una possibilità teorica, ed è il motivo per cui la risposta non viene creduta
sulla parola.

`verifyUrl` rifiuta inoltre gli indirizzi su rete interna — `localhost`,
`127.x`, `10.x`, `192.168.x`, `169.254.x`: un indirizzo proposto da un modello
non deve poter diventare una sonda sull'infrastruttura.

### I motori disponibili

| `AI_SEARCH_PROVIDER` | Modello atteso | Chiave | Costo |
|---|---|---|---|
| `mock` (predefinito) | — | nessuna | non cerca e non inventa |
| `gemini` | `gemini-2.5-flash` | `GEMINI_API_KEY` | **quota gratuita giornaliera**, nessun conto da attivare |
| `anthropic` | `claude-sonnet-5` | `ANTHROPIC_API_KEY` | a consumo, richiede credito |
| `openai` | `gpt-5.6` | `OPENAI_API_KEY` | a consumo, richiede credito |

Gemini è l'unico che cerca senza un conto con fatturazione attiva: la chiave si
crea in un minuto su [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
Per un manuale — dove si cercano fonti a ondate, non di continuo — la quota
giornaliera è ampiamente sufficiente.

Il modello deve appartenere al fornitore. Cambiare l'uno dimenticando l'altro è
una svista frequente e produrrebbe un errore oscuro dall'altra parte: il
registro se ne accorge, usa il predefinito del fornitore e **lo dichiara**.

Gli errori dei due fornitori vengono riportati per esteso, non ridotti al
codice HTTP: «400» non permette di distinguere una chiave sbagliata da un
credito esaurito, e costringe a indovinare. Il motivo lo scrivono sempre
loro; il compito è riferirlo.

### Che cosa succede senza chiave

Con `AI_SEARCH_PROVIDER=mock` (predefinito) **non viene cercato nulla, e nulla
viene inventato**: elenco vuoto e avviso esplicito. La tentazione sarebbe
generare qualche risultato verosimile per mostrare l'interfaccia popolata, ma
un elenco di fonti inventate è peggio di un elenco vuoto — perché sembra un
risultato.

### Dalla proposta alla fonte

Le fonti trovate entrano in biblioteca con stato `proposed`: non vengono
indicizzate e non partecipano alla ricerca finché qualcuno non le accetta.
Accettandole parte l'indicizzazione, e da quel momento sono fonti del progetto
come le altre. Fra il trovarle e l'usarle c'è sempre una persona.

| Comando | Che cosa fa |
|---|---|
| **Cerca fonti sul web** | Va a cercare materiale nuovo per il manuale |
| **Verifica affermazioni** | Collega le frasi prive di rimando a ciò che già si ha: documentazione ufficiale e biblioteca |

---

## 11. «Non lo conosco» non è «non esiste»

L'audit di un capitolo apre i collegamenti citati. Non è un controllo in più:
è ciò che distingue un rilievo da un sospetto.

Senza, l'unica cosa che il sistema può dire di una pagina non censita è «non
risulta nel mio indice» — un'affermazione **su di sé**, non sul mondo. Una
pagina può esistere benissimo senza essere nel catalogo, e presentare quel
dubbio come rilievo grave fa due danni: fa perdere tempo al revisore, e gli
insegna a non fidarsi dei rilievi. Il secondo è il peggiore, perché toglie
valore anche a quelli giusti.

Aprendo l'indirizzo la domanda cambia, e diventa una a cui qualcuno risponde:

| Esito | Che cosa compare |
|---|---|
| Risponde, ed è censita | Nessun rilievo |
| Risponde, ufficiale, non censita | `info` — «Pagina ufficiale non ancora censita»: è l'**indice** a essere incompleto, non il capitolo. Con l'invito ad aggiungerla |
| Non risponde | `high` — «Collegamento non raggiungibile», con lo stato HTTP. Un collegamento morto su carta stampata non è correggibile |

Il sospetto emesso a monte viene **rimosso** quando arriva l'esito reale:
leggere un dubbio e la sua risposta, nell'ordine sbagliato, è peggio che
leggere solo la risposta.

Su `citations`, `is_reachable` dice adesso ciò che il nome promette: se la
pagina ha risposto quando è stata aperta.

### Riga zero

Le righe di un file partono da 1. Uno zero significa «riga non determinata», e
viene mostrato come tale invece di mandare il revisore a cercare qualcosa a una
riga che non esiste.
