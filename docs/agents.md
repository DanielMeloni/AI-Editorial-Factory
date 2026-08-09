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

Distingue la documentazione ufficiale del produttore (`cloud.google.com`,
`dataform.co`, `developers.google.com`) dalle fonti della comunità
(Stack Overflow, Medium). Le seconde sono utili, ma non sostituiscono la prima
quando l'affermazione riguarda il comportamento del prodotto. Segnala anche i
capitoli privi di qualsiasi riferimento e gli URL non cifrati.

### Technical Writer

Propone una revisione **senza toccare l'originale**: crea una nuova
`chapter_version` con `origin = 'ai_proposal'`.

Nella versione deterministica interviene solo dove non c'è nulla da
interpretare:

- dichiara il linguaggio dei blocchi di codice che non lo indicano, deducendolo
  dal contenuto;
- annota il testo alternativo mancante sulle immagini, marcandolo da rivedere;
- elenca **in coda** al documento le affermazioni prive di fonte, senza spezzare
  la lettura.

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
