# Visual e copertine

> Stato: **Fase 5**. Diagrammi deterministici, adapter visuale con approvazione,
> Cover Studio con calcolo del dorso.

## 1. Due famiglie, due meccanismi

| | Diagrammi tecnici | Illustrazioni |
|---|---|---|
| Prodotti da | Codice, in modo deterministico | Adapter visuale configurabile |
| Sorgente | Mermaid o SVG | PNG in bucket privato |
| Riproducibili | Sempre, per costruzione | Tramite prompt e seme |
| Costo | Nessuno | Quello del provider |
| Approvazione | **Richiesta** | **Richiesta** |

La separazione non è di comodo. Su un DAG un arco inventato è un **errore
tecnico**, non una licenza artistica: il lettore lo prenderebbe per vero. Per
questo dipendenze, flussi, architetture, sequenze e schemi si generano dal
codice, e il modello visuale resta fuori.

## 2. Generatori disponibili

| Funzione | Produce |
|---|---|
| `buildDependencyDag` | Grafo delle dipendenze dai `ref()` Dataform |
| `buildFlowDiagram` | Flusso verticale, con nodi condizionali a due uscite |
| `buildArchitectureDiagram` | Livelli sovrapposti con i loro componenti |
| `buildSequenceDiagram` | Sequenza fra attori, con risposte tratteggiate |
| `buildComparisonTable` | **Tabella Markdown**, non un diagramma |
| `buildSchemaDiagram` | Schema di tabella BigQuery con partizionamento e clustering |

Il confronto fra alternative è deliberatamente una tabella: si legge meglio,
è accessibile agli screen reader e resta ricercabile nel testo. Un'immagine no.

Ogni generatore produce **sempre** un testo alternativo descrittivo, non un
segnaposto.

## 3. Adapter visuale

L'illustrazione conserva tutto ciò che serve a riprodurla: prompt, negative
prompt, provider, modello, seme, dimensioni, stile, didascalia, testo
alternativo, stato di approvazione, versione, costo e percorso privato.

Il **testo alternativo è obbligatorio**: senza, la generazione non parte.

Il file finisce in `generated-assets`, bucket privato, e si vede solo tramite
URL firmato a scadenza di cinque minuti. Se l'inserimento della riga fallisce
dopo il caricamento, il file viene rimosso: niente asset orfani.

Sono previste **varianti**: si riparte da un asset esistente conservando prompt e
parametri, e la nuova immagine ne diventa figlia (`parent_asset_id`). Approvando
una figura, le precedenti dello stesso capitolo e tipo passano a `superseded`:
resta una sola versione valida per volta.

Nessun testo importante viene generato dentro l'immagine.

### Provider mock

Genera un **PNG reale** — non un segnaposto rotto — con una sfumatura derivata
dal prompt: stesso prompt, stessa immagine. Serve a percorrere per intero
generazione, varianti e approvazione senza consumare crediti. Gli adapter verso
provider visuali reali si innestano sulla stessa interfaccia.

## 4. Il dorso

**Non esiste un valore universale.** Dipende dalla carta e dal fornitore di
stampa. Tre formule, il fattore lo fornisce il fornitore:

| Formula | Calcolo | Quando |
|---|---|---|
| `mm_per_page` | pagine × mm/pagina | Comune in Europa |
| `pages_per_inch` | pagine ÷ PPI × 25,4 | Comune negli Stati Uniti |
| `fixed` | valore imposto | Il fornitore comunica il dorso |

A tutte si può sommare lo spessore dei cartoni, per la brossura rigida.

Il dorso è definitivo **solo con il numero di pagine definitivo**:
`canLockSpine()` rende esplicita e verificabile quella condizione, e
l'interfaccia distingue il valore provvisorio da quello definitivo. Una pagina
in più sposta la piega, e una copertina stampata con il dorso sbagliato non si
recupera.

`estimateMmPerPageFromGrammage()` offre una stima dalla grammatura quando il
fornitore non pubblica il dato. È dichiarata **stima**: la mano della carta varia
sensibilmente, e non va usata per la stampa definitiva.

## 5. Geometria della copertina

```
┌─────────── foglio, abbondanza compresa ───────────┐
│  ┌──── quarta ────┬─ dorso ─┬──── fronte ────┐    │
│  │  ┌──────────┐  │         │  ┌──────────┐  │    │
│  │  │  sicura  │  │         │  │  sicura  │  │    │
│  │  └──────────┘  │         │  └──────────┘  │    │
│  └────────────────┴─────────┴────────────────┘    │
└───────────────────────────────────────────────────┘
```

Larghezza totale = 2 × pagina + dorso + 2 × abbondanza.

Il codice a barre va in basso a destra sulla quarta, dentro il margine di
sicurezza: è la collocazione che i distributori si aspettano. Se il dorso è
sotto i 6 mm, il testo verticale viene omesso perché non sarebbe leggibile.

## 6. Codice a barre ISBN

Costruito dalla specifica **EAN-13**, cifra per cifra: 95 moduli più le zone di
quiete, alternanza A/B determinata dalla prima cifra, barre di guardia estese.

Un codice a barre non si genera con un modello visuale: deve essere letto da uno
scanner, e questo richiede larghezze esatte.

L'ISBN viene **validato**: la cifra di controllo deve tornare. Un ISBN-10 viene
convertito in ISBN-13. Se non è valido, la generazione fallisce con un messaggio
esplicito invece di produrre un codice illeggibile — stampato su diecimila copie
non si corregge.

## 7. Testi programmatici

Titolo, sottotitolo, autore, collana, ISBN e codice a barre sono composti
**sopra** l'immagine, non generati dentro di essa. Tre motivi: la leggibilità è
garantita, la posizione è controllata al millimetro, e il testo resta
verificabile invece di dover essere riletto da un'immagine.

I testi passano da una funzione di neutralizzazione XML: un titolo contenente
`<script>` non può alterare l'SVG.

## 8. Verifica

`npm test` copre le tre formule del dorso e i loro casi limite, la condizione di
blocco, la geometria completa (compreso il dorso nullo e quello troppo stretto),
il posizionamento del codice a barre dentro il margine, la cifra di controllo
EAN-13 su ISBN noti, il rifiuto degli ISBN non validi, la neutralizzazione XML e
il determinismo di tutti i generatori.
