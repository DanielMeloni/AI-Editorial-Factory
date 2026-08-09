# Pubblicazione

> Stato: **Fase 6**. Markdown, HTML, PDF, lezione e articolo, con download da
> archivio privato.

## 1. Si esporta solo ciò che è approvato

Il controllo è esplicito: se la versione corrente ha `origin = 'ai_proposal'` e
non è approvata, l'esportazione viene rifiutata con un messaggio che rimanda
alla scheda Revisioni.

Senza questa regola il gate umano della Fase 4 sarebbe decorativo: basterebbe
esportare per pubblicare una proposta che nessuno ha letto.

## 2. I quattro formati

| Formato | Contenuto |
|---|---|
| **Markdown** | Front matter YAML, figure numerate, sezione dei riferimenti |
| **HTML** | Documento semantico e **sanificato**, con foglio di stile per lettura e stampa |
| **PDF** | Impaginato, con numerazione delle pagine e riferimenti in coda |
| **JSON** | Lezione e articolo in forma strutturata, per un sistema a valle |

Un formato fallito non compromette gli altri: ognuno ha la sua riga in
`exports` con stato ed errore.

### Markdown

Normalizza solo ciò che è meccanico, mai il testo. Le figure diventano
«Figura 11.3» — il prefisso del capitolo conta, in un'opera di trenta — senza
duplicare un'etichetta già presente. I riferimenti sono ordinati mettendo per
prime le fonti ufficiali.

### HTML

Il Markdown proviene da un archivio caricato: **può contenere qualsiasi cosa**.
La sanitizzazione non è opzionale — senza, un `<script>` nel manuale
diventerebbe codice eseguito nel browser di chi apre l'anteprima. Lo schema
parte da quello predefinito di `rehype-sanitize` e aggiunge soltanto i tag
semantici che servono a un manuale. `script`, `style`, `iframe`, gli URL
`javascript:` e i gestori di eventi restano fuori.

La struttura è reale: `<article>`, `<header>`, `<section>`, `<figure>` con
`<figcaption>`, `<footer>` per i riferimenti. Ogni titolo riceve un `id`, così i
collegamenti interni funzionano. I paragrafi contenenti la sola immagine
diventano `<figure>`: nessun generatore Markdown lo fa da solo.

### PDF

**`@react-pdf/renderer`, JavaScript puro.** L'alternativa consueta — Puppeteer
con Chromium — richiede un binario da oltre cento megabyte nel bundle
serverless, che eccede i limiti di una Vercel Function e va installato a ogni
avvio a freddo. Qui non c'è alcun binario.

Il documento è costruito dall'**albero Markdown**, non dall'HTML: la tipografia è
controllata direttamente e non dipende da un motore di rendering. Sono gestiti
titoli, enfasi, codice con linguaggio, citazioni, elenchi ordinati e non,
tabelle, separatori, figure e collegamenti — con l'URL stampato accanto al
testo, perché su carta un collegamento cliccabile non serve a nulla se non se ne
legge la destinazione.

## 3. Lezione e articolo

**La trasformazione non altera il significato tecnico.** Ciò che si può
estrarre viene estratto alla lettera; ciò che richiede scrittura resta
dichiarato come da completare.

Un obiettivo didattico verosimile ma falso è peggio di un obiettivo assente: il
primo supera una revisione distratta, il secondo no.

### Lezione

| Campo | Origine |
|---|---|
| Titolo | Etichetta del capitolo + titolo |
| Obiettivi | Sezione «Obiettivi», alla lettera |
| Prerequisiti | Sezione «Prerequisiti», alla lettera |
| Spiegazione | Corpo del capitolo, esclusa la parte dimostrativa |
| Dimostrazione | Sezione «Esempio» e blocchi di codice, invariati |
| Laboratorio | Sezione «Esercizi», alla lettera |
| Quiz | Domande impostate sui titoli; **opzioni e risposta da scrivere** |
| Riepilogo | Sezione di chiusura |
| Compito finale | **Da definire** |

`pendingAuthoring` elenca esplicitamente ciò che una persona deve ancora
scrivere, e l'interfaccia lo mostra.

### Articolo

Slug, meta description ricavata dal testo reale e troncata sul confine di
parola, introduzione, corpo, conclusione, codice e immagini invariati. I dati
SEO sono calcolati, non stimati a occhio: parole chiave per frequenza (escluse
quelle vuote di significato), conteggio parole, tempo di lettura a 200
parole/minuto. La **call to action resta vuota** e dichiarata: dipende da dove
l'articolo verrà pubblicato.

## 4. Download

I file stanno in `publication-exports`, bucket **privato**. Non esiste un URL
statico: il collegamento viene chiesto al momento del clic, è firmato e scade in
**due minuti**. Il server verifica l'appartenenza all'organizzazione prima di
emetterlo.

Ogni esportazione registra dimensione e **checksum SHA-256**: un file alterato
in archivio è riconoscibile.

## 5. Struttura dei percorsi

```
{organization_id}/{project_id}/exports/{chapter_id}/v{versione}/{nome}.{ext}
```

La versione nel percorso è deliberata: esportazioni successive della stessa
versione si sovrascrivono, versioni diverse convivono.

## 6. Verifica

`npm test` copre: front matter con quoting YAML corretto, numerazione delle
figure e non duplicazione, ordinamento dei riferimenti, **rimozione di
`<script>`, `onerror`, `<iframe>`, `javascript:` e `<style>`**, neutralizzazione
dei metadati contenenti HTML, firma e marcatore di fine file del PDF, resistenza
del generatore PDF a tutti i costrutti Markdown e agli accenti italiani,
estrazione fedele di lezione e articolo, e — soprattutto — che quiz, compito
finale e call to action **non vengano inventati**.
