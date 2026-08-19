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

## 6. ISBN, senza codice a barre in copertina

La copertina **non porta il codice a barre**: è una scelta editoriale, e la
composizione resta immagine più tipografia. Chi stampa e chi distribuisce lo
aggiungono a valle, sul foglio di stampa, dove sanno anche quali zone di quiete
pretende il loro scanner.

L'ISBN resta un dato del volume e viene **validato** al salvataggio: la cifra di
controllo deve tornare, un ISBN-10 viene convertito in ISBN-13. Un ISBN
sbagliato in scheda è sbagliato ovunque finisca dopo.

Il generatore EAN-13 — 95 moduli, alternanza A/B dalla prima cifra, barre di
guardia estese — resta in `src/lib/cover/barcode.ts` con i suoi test: serve la
validazione, e il giorno in cui il codice a barre servisse davvero non andrebbe
riscritto. Semplicemente, non viene composto sulla copertina.

## 7. Testi programmatici e logo dello strumento

Titolo, sottotitolo, autore e collana sono composti **sopra** l'immagine, non
generati dentro di essa. Tre motivi: la leggibilità è garantita, la posizione è
controllata al millimetro, e il testo resta verificabile invece di dover essere
riletto da un'immagine.

Lo stesso vale per il **logo dello strumento** oggetto del volume — BigQuery,
Dataform, quello che sia. Si carica in fase di input, accanto alle fonti, e
viene composto in basso a destra sul fronte, dentro il margine di sicurezza,
con `preserveAspectRatio` a `meet`: un marchio non si ritaglia per far quadrare
un riquadro. Non lo disegna il modello visuale, e non per gusto — un marchio
ridisegnato somiglia al marchio, e somigliare non basta né al lettore né a chi
lo possiede.

Il logo entra però fra i **riferimenti** della generazione, in testa alla fila:
dice al modello da quale gamma cromatica e da quale geometria partire, mentre il
prompt gli vieta esplicitamente di riprodurre marchi.

I testi passano da una funzione di neutralizzazione XML: un titolo contenente
`<script>` non può alterare l'SVG. Il maiuscolo dell'occhiello si applica
**prima** della neutralizzazione, altrimenti `&amp;` diventerebbe `&AMP;`, che
non è più un'entità valida.

## 7-bis. Il preset di brand

Palette, tipografia e direzione visuale stanno in `src/lib/cover/brand.ts`, in
un posto solo. Sono ricavate dal sito dell'autore — fondo blu notte quasi nero,
soggetto tecnico illuminato da dentro con blu elettrico e ciano, geometrie
pulite — e le usano tre cose che devono somigliarsi: i fondi di riserva
dell'anteprima, la tipografia composta e il prompt di generazione.

Il *negative prompt* è parte del preset e vieta ciò che romperebbe la
composizione: testo, marchi, volti, fondi chiari, colori caldi dominanti.

## 7-ter. Anteprime dei corsi

Stessa identità, altro formato: `buildCoursePreviewSvg` produce un 16:9 con
occhiello, titolo, durata, autore e logo. È **costruita dal codice**, come i
diagrammi e per la stessa ragione: il titolo di un corso e il numero di lezioni
sono dati, e un'immagine generata li scriverebbe storti e non correggibili.

Stesso corso, stessa immagine. Si scarica come SVG, con il logo incorporato in
`data:` URI e non come URL firmato: un collegamento a scadenza, fuori
dall'applicazione, diventerebbe un riquadro vuoto la mattina dopo.

## 8. Verifica

`npm test` copre le tre formule del dorso e i loro casi limite, la condizione di
blocco, la geometria completa (compreso il dorso nullo e quello troppo stretto),
la cifra di controllo EAN-13 su ISBN noti, il rifiuto degli ISBN non validi,
l'assenza del codice a barre dalla composizione, la palette di riserva, il logo
composto senza ritaglio, la neutralizzazione XML e il determinismo di tutti i
generatori — anteprime dei corsi comprese.
