# Collane editoriali e coerenza multi-volume

> **Stato: Fase 8, non implementata.**
>
> Sono presenti fin d'ora: le fondamenta del database (migration 13), i modelli
> di dominio TypeScript e questo documento di progetto. **Non** sono presenti
> interfaccia, agenti e workflow multi-volume: arrivano con la Fase 8, dopo
> l'approvazione della Fase 7.
>
> Nell'interfaccia italiana il termine è **«Collane»**; nel codice è `series`.

## 1. Il problema

Un volume tecnico si scrive da solo. Una collana no.

```
Collana: Google Cloud in Pratica
├── Volume 1 – Dataform in Pratica
├── Volume 2 – BigQuery in Pratica
├── Volume 3 – Dataplex in Pratica
└── Volume X – volume futuro
```

Quattro volumi scritti a distanza di mesi divergono in silenzio: lo stesso
concetto prende due nomi, un termine viene tradotto in due modi, il quarto
volume dà per acquisito un capitolo che il primo non contiene, le copertine
somigliano ma non coincidono.

La Fase 8 esiste per rendere quella divergenza **visibile e governata**, non per
impedirla: un volume ha il diritto di discostarsi, purché la deviazione sia
dichiarata e motivata.

## 2. Il vincolo che regge tutto

**I volumi pubblicati non si modificano mai in silenzio.**

Una copia stampata non si aggiorna. Un lettore che possiede il Volume 1 non
riceve una notifica quando la terminologia cambia. Cambiare la linea editoriale
non può quindi riscrivere ciò che è già uscito: può solo **proporre una nuova
edizione**.

È lo stesso principio dell'immutabilità del capitolo originale, portato al
livello della collana.

## 3. Rotte

```
/series                              elenco delle collane
/series/new                          creazione
/series/[seriesId]                   cruscotto
/series/[seriesId]/volumes           volumi e riordino
/series/[seriesId]/editorial-style   linea editoriale versionata
/series/[seriesId]/visual-identity   sistema visivo versionato
/series/[seriesId]/cover-system      template di copertina e vista Scaffale
/series/[seriesId]/shared-content    contenuti riutilizzabili
/series/[seriesId]/terminology       glossario condiviso
/series/[seriesId]/consistency       report di coerenza
/series/[seriesId]/release-plan      roadmap, timeline, Kanban
/series/[seriesId]/exports           catalogo e materiali
```

## 4. La decisione di modellazione

> Richiesta esplicita: stabilire se `projects` debba avere `series_id` e
> `volume_number`, oppure se la relazione debba vivere solo in
> `series_volumes`. Scegliere **una sola fonte di verità** e documentarla.

### Decisione: la fonte di verità è `series_volumes`

`projects` **non** riceve né `series_id` né `volume_number`.

**Perché.**

1. **La cardinalità non è quella di una chiave esterna.** Un volume può esistere
   *senza* progetto — «Volume 4, previsto per l'autunno» è un elemento di piano
   prima che di redazione. E un progetto può esistere senza collana. La
   relazione è opzionale su entrambi i lati: la forma naturale è un'entità
   propria, non una colonna.

2. **Un volume ha attributi che non appartengono a un progetto.** Data prevista,
   edizione, ISBN di quella edizione, dipendenze da altri volumi, deroghe alle
   regole della collana, posizione nel piano. Metterli su `projects`
   significherebbe sporcare l'entità editoriale con dati di collana, e lasciarli
   `NULL` per ogni progetto che collana non ha.

3. **Due fonti divergono, sempre.** Con `projects.series_id` *e*
   `series_volumes.project_id` esistono due percorsi per la stessa verità.
   Prima o poi un aggiornamento tocca l'uno e non l'altro, e nessun vincolo può
   accorgersene senza un trigger che li confronti.

4. **I vincoli stanno dove serve.** `unique (series_id, volume_number)` e
   `unique (project_id)` vivono naturalmente su `series_volumes`. Sulla colonna
   di `projects` il primo sarebbe impossibile da esprimere.

**Conseguenza pratica.** Per sapere a quale collana appartiene un progetto si
passa da `series_volumes`. È un join in più; è il prezzo di non avere due verità.

## 5. Ereditarietà

Ogni regola della collana ha, nel singolo volume, uno di tre stati:

| Stato | Significato |
|---|---|
| `inherited` | Il volume segue la collana. Cambia con essa |
| `overridden` | Il volume usa una variante locale, **con motivazione obbligatoria** |
| `locked` | La regola non è derogabile nel volume |

La motivazione non è un campo di cortesia: è ciò che distingue una scelta
editoriale da una svista. Fra due anni, davanti a un volume che usa un font
diverso, la domanda sarà «perché?» — e la risposta deve essere nel sistema.

### Regole ereditabili

| Ambito | Regole |
|---|---|
| Editoriale | linea editoriale, tono, terminologia, regole tipografiche, formato delle citazioni |
| Visivo | palette, font, griglia, stile immagini, stile diagrammi |
| Copertina | template, struttura del dorso, struttura della quarta |
| Struttura | front matter, back matter, convenzioni per codice e callout |
| Uscita | configurazioni di esportazione |

### Risoluzione

`resolveRule()` in `src/lib/series/rules.ts` è già implementata e collaudata:
data una regola di collana e l'eventuale deroga del volume, restituisce il
valore effettivo e la ragione. Un tentativo di deroga su una regola `locked`
viene **rifiutato**, non ignorato in silenzio.

## 6. Versionamento della linea editoriale

Ogni modifica genera una **versione**, mai una sovrascrittura. La versione porta
autore, data, motivazione, regole toccate, volumi coinvolti, anteprima degli
effetti e stato di approvazione.

```
Proposta di modifica
   ↓
Analisi dell'impatto        quali volumi, quali regole, quali deroghe saltano
   ↓
Anteprima per volume        prima/dopo, volume per volume
   ↓
Approvazione umana          nessuna applicazione automatica
   ↓
Applicazione ai volumi NON pubblicati
   ↓
Proposta separata per i volumi PUBBLICATI → nuova edizione
```

Il ramo finale è il punto critico. Un volume pubblicato non entra
nell'applicazione automatica: genera una proposta distinta, che se accettata
produce una **nuova edizione**, con il suo ISBN e la sua data.

## 7. Terminologia condivisa

Glossario di collana. Per ogni termine: termine preferito, definizione, termini
sconsigliati, sinonimi, traduzione, abbreviazione, distinzione
maiuscole/minuscole, fonte, volumi che lo usano, note editoriali.

Il controllo deve rilevare: termini usati in modo diverso fra volumi,
definizioni contraddittorie, traduzioni incoerenti, acronimi mai spiegati,
concetti duplicati sotto nomi diversi, variazioni non autorizzate.

Non è un problema estetico. In un manuale tecnico due nomi per la stessa cosa
costringono il lettore a chiedersi se siano davvero la stessa cosa.

## 8. Contenuti condivisi

Biografia, descrizione della collana, copyright, disclaimer, ringraziamenti,
convenzioni, struttura dei laboratori, template degli esercizi, callout,
glossario, bibliografia, logo, icone, elementi grafici, pagine promozionali
degli altri volumi.

**Un contenuto condiviso non viene copiato.** Viene *referenziato* e
versionato: modificarlo produce una proposta di aggiornamento nei volumi
collegati, che resta soggetta ad approvazione. Una copia scollegata è il modo
più rapido per ritrovarsi con quattro biografie diverse dello stesso autore.

## 9. Riferimenti fra volumi

```
Volume 2 richiede Volume 1
Volume 3 approfondisce il Capitolo 12 del Volume 1
Volume 4 può essere letto indipendentemente
```

`cross_volume_references` registra la relazione, il capitolo di origine e quello
di destinazione. Serve a due cose: verificare che un prerequisito esista davvero,
e accorgersi quando il Capitolo 12 del Volume 1 cambia numero.

## 10. Coerenza

**Series Curriculum Agent** — progressione della difficoltà, prerequisiti fra
volumi, concetti introdotti più volte, concetti usati prima di essere spiegati,
sovrapposizioni, lacune, esercizi duplicati, coerenza degli esempi.

**Series Consistency Agent** — coerenza editoriale, terminologica, visiva,
didattica e tecnica; riferimenti incrociati; versioni tecnologiche citate;
elementi condivisi obsoleti; **differenze autorizzate distinte da quelle non
autorizzate**.

Ogni problema porta: gravità, volume, posizione, regola violata, proposta di
correzione, stato, responsabile, approvazione.

L'ultima distinzione è quella che rende utile il report. Un elenco che segnala
anche le deroghe deliberate viene ignorato dopo due settimane.

## 11. Sistema visivo

Versionato come la linea editoriale, e diviso in due:

| Fisso in tutta la collana | Variabile per volume |
|---|---|
| logo | colore del volume |
| posizione del titolo | illustrazione |
| font e scale tipografiche | numero |
| griglia e spaziature | sottotitolo |
| stile del dorso | icona dell'argomento |

È la parte variabile a rendere riconoscibile il singolo volume; è quella fissa a
rendere riconoscibile la collana. Confonderle produce o quattro libri identici o
quattro libri scollegati.

## 12. Cover System e vista Scaffale

Ogni copertina deriva dal template di collana e produce: fronte, retro, dorso,
versione digitale, miniatura, immagine promozionale e anteprima affiancata.

Resta valida la regola della Fase 5: **il modello visuale produce solo
illustrazioni e sfondi**. Tipografia, logo, titolo, autore, ISBN e codice a barre
sono aggiunti programmaticamente. Il dorso resta specifico del volume, calcolato
sul numero definitivo di pagine e sulle specifiche del fornitore.

La vista **Scaffale** mostra tutti i dorsi affiancati. È il controllo che nessun
altro strumento fa: una collana si guarda in libreria di taglio, non di piatto.

## 13. Piano editoriale

Roadmap, ordine, priorità, dipendenze, avanzamento, date previste ed effettive,
responsabili, stato, target, canali. Due viste: timeline e Kanban.

## 14. Agenti aggiuntivi

| Agente | Compito |
|---|---|
| Series Architect | Progetta struttura e roadmap della collana |
| Series Curriculum | Verifica progressione e dipendenze didattiche |
| Series Consistency | Controlla la coerenza fra volumi |
| Series Visual Director | Governa identità visiva e differenze controllate |
| Cross-Volume Reference | Gestisce riferimenti e collegamenti fra volumi |
| Series Publishing | Produce catalogo e materiali della collana |

Come i dodici già previsti: **propongono, non applicano**. Nessuno di essi può
modificare un volume senza approvazione umana.

## 15. Esportazioni

Catalogo in PDF, pagina web della collana, scheda di ogni volume, anteprima di
tutte le copertine, vista di tutti i dorsi, roadmap editoriale, style guide
esportabile, glossario condiviso, report di coerenza, pacchetto promozionale.

## 16. Le diciassette tabelle

Create dalla **migration 13**, già applicabile.

| Tabella | Contenuto |
|---|---|
| `series` | La collana: nome, curatore, editore, pubblico, area tematica |
| `series_members` | Chi lavora alla collana e con quale ruolo |
| `series_volumes` | **Fonte di verità** del volume e del suo legame col progetto |
| `series_style_versions` | Linea editoriale e sistema visivo, versionati e immutabili |
| `series_rules` | Le singole regole di una versione di stile |
| `series_rule_overrides` | Deroghe di volume, con motivazione obbligatoria |
| `series_shared_contents` | Contenuti riutilizzabili, referenziati e non copiati |
| `series_shared_content_versions` | Le loro versioni |
| `series_terms` | Glossario condiviso |
| `series_assets` | Logo, icone, elementi grafici della collana |
| `series_cover_templates` | Template di copertina, parte fissa e variabile |
| `series_release_plans` | Piano di pubblicazione per volume |
| `series_change_proposals` | Proposte di modifica alle regole condivise |
| `series_change_impacts` | Impatto previsto, volume per volume |
| `cross_volume_references` | Riferimenti fra volumi e capitoli |
| `series_consistency_runs` | Esecuzioni del controllo di coerenza |
| `series_consistency_issues` | Problemi rilevati, con gravità e responsabile |

### Vincoli imposti dal database

Non affidati alla disciplina applicativa:

- **Numero di volume univoco** nella collana — `unique (series_id, volume_number)`
- **Un progetto appartiene a un solo volume** — `unique (project_id)`
- **Versioni di stile immutabili** — un trigger rifiuta la modifica di una
  versione già pubblicata
- **Volumi pubblicati non cancellabili** — un trigger rifiuta `DELETE` su un
  volume in stato `published`
- **Deroga motivata** — `check`: `overridden` richiede una motivazione non vuota
- **Regola bloccata non derogabile** — un trigger rifiuta una deroga su una
  regola `locked`
- **RLS su tutte e diciassette**, con `ENABLE` e `FORCE`, sulla stessa regola di
  appartenenza all'organizzazione usata dal resto dello schema

## 17. Stati del volume

```
planned → draft → in_review → approved → ready_for_publication → published → archived
```

Il numero di un volume **pianificato** si riordina liberamente. Il numero di un
volume **pubblicato** richiede una conferma esplicita: cambiarlo invalida ogni
riferimento incrociato e ogni citazione esterna.

## 18. Criteri di accettazione

La Fase 8 è completa quando: una collana si crea; contiene un numero arbitrario
di volumi; un progetto esistente diventa un volume; un volume nasce dalle regole
della collana; le regole condivise si ereditano; le eccezioni sono tracciate e
motivate; gli stili sono versionati; una modifica mostra l'impatto **prima** di
essere applicata; i volumi pubblicati non vengono sovrascritti; terminologia e
glossario sono condivisi; il controllo di coerenza funziona; le copertine sono
coordinate; la vista dei dorsi è disponibile; la roadmap è gestibile; la RLS
impedisce accessi fra organizzazioni; lint, typecheck, test e build passano.

## 19. Che cosa esiste già, oggi

| Elemento | Stato |
|---|---|
| Migration 13 con le 17 tabelle, RLS e vincoli | **presente**, applicabile |
| Modelli di dominio TypeScript e stati | **presenti** |
| Risoluzione dell'ereditarietà `resolveRule()` | **presente**, con test |
| Questo documento di progetto | **presente** |
| Rotte `/series/*` | assenti |
| I sei agenti di collana | assenti |
| Workflow multi-volume | assenti |
| Vista Scaffale e Cover System di collana | assenti |
| Esportazioni di collana | assenti |
