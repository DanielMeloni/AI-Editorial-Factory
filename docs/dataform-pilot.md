# Progetto pilota — *Dataform in Pratica, Volume 1*

> L'applicazione è generica. Dataform è il primo caso d'uso, non una
> personalizzazione: nulla di quanto segue è codificato nel prodotto.

## 1. L'archivio di partenza

Circa 120.000 parole, 30 capitoli Markdown, 10 appendici, copertine, script
Python e LaTeX, PDF di edizioni precedenti.

**L'archivio reale non entra nel repository.** `.gitignore` esclude `*.zip` e la
cartella `private/`. Il manuale si carica dall'applicazione, finisce in un
bucket privato e resta raggiungibile solo tramite URL firmati.

Per lo sviluppo e i test esiste una **fixture sintetica**
(`tests/fixtures/build-fixture.ts`) che riproduce la *forma* dell'archivio —
parti numerate, 30 capitoli, 10 appendici, asset, script, indice — con contenuto
inventato.

## 2. Struttura riconosciuta

```
README.md                              ← indice, con front matter YAML
01-fondamenti/
  capitolo-01-che-cos-e-dataform.md
  …
02-modellazione/
  capitolo-11-incremental-tables.md    ← il capitolo del workflow pilota
  …
05-appendici/
  appendice-a-glossario.md
  …appendice-j-indice-analitico.md
assets/figura-N.png
scripts/*.py  scripts/*.js  latex/*.tex
definitions/*.sqlx   dataform.json
```

## 3. Il problema dell'ordinamento

Ordinare per nome file mette il **capitolo 11 subito dopo l'1**:

```
1, 10, 11, 2, 20, 3     ← ordinamento alfabetico
1, 2, 3, 10, 11, 20     ← ordinamento editoriale
```

`src/lib/ingest/ordering.ts` estrae il numero e lo rende esplicito. Riconosce:

| Forma | Interpretazione |
|---|---|
| `capitolo-11-incremental-tables.md` | capitolo 11, «Incremental tables» |
| `cap11.md`, `ch-11.md`, `chapter_11.md` | capitolo 11 |
| `11-incremental.md`, `011-incremental.md` | capitolo 11 |
| `parte-02-modellazione/` | parte 2 |
| `parte-ii-fondamenti/` | parte 2 (numeri romani) |
| `appendice-a-glossario.md` | appendice A |
| `appendix-c.md`, `app-j.md` | appendici C e J |
| `prefazione.md`, `introduzione.md` | apertura |
| `bibliografia.md`, `glossario.md` | chiusura |

L'ordine finale è: apertura → parti numerate → appendici → chiusura. A parità di
categoria vince il numero; gli elementi senza numero vanno in coda.

## 4. Il manifesto

`project_manifests` è la fonte di verità sulla struttura. Contiene titolo,
autore, volume, l'albero completo, gli aggregati e — soprattutto — le
**differenze rilevate**.

Il file indice **non viene creduto sulla parola**: viene confrontato con la
struttura reale delle cartelle. Le differenze sono segnalate, mai risolte in
silenzio.

| Segnalazione | Gravità | Significato |
|---|---|---|
| `indice_riferisce_file_inesistente` | errore | L'indice cita un capitolo che non c'è |
| `capitolo_assente_dall_indice` | avviso | Un file esiste ma l'indice lo ignora |
| `numerazione_interrotta` | avviso | Salto fra due numeri consecutivi |
| `numero_duplicato` | errore | Due capitoli con lo stesso numero |
| `immagine_mancante` | avviso | Una figura è citata ma il file non c'è |
| `capitolo_senza_titolo` | avviso | Nessun `#` di primo livello |
| `indice_non_trovato` | informazione | Struttura ricavata solo dalle cartelle |

Rigenerare il manifesto **non** distrugge il precedente: viene creata una nuova
versione e la vecchia resta consultabile.

## 5. Sicurezza dell'importazione

| Difesa | Dove |
|---|---|
| L'archivio non passa dal server (limite 4,5 MB) | URL firmato, caricamento diretto a Storage |
| Firma `PK\x03\x04` verificata sui byte | Il tipo dichiarato dal browser non è attendibile |
| Percorsi verificati prima di decomprimere | `path-guard.ts` |
| Risalita `../` rifiutata, anche bilanciata | `attraversamento` |
| Percorsi assoluti e unità Windows rifiutati | `percorso_assoluto`, `unita_windows` |
| Byte nulli e caratteri di controllo rifiutati | — |
| Nomi riservati (`CON`, `NUL`, `LPT1`…) rifiutati | — |
| Limiti su voci, dimensione, profondità | `limits.ts`, configurabili |
| Rapporto di compressione oltre 200× rifiutato | Difesa contro le zip bomb |
| SHA-256 per ogni file | Individuazione dei duplicati |
| File di sistema ignorati senza errore | `__MACOSX`, `.DS_Store`, `node_modules`… |
| Errore su un file → annotato, non fatale | L'importazione prosegue |
| `.py`, `.js`, `.sql`, `.sqlx` trattati come testo inerte | Mai eseguiti |

## 6. Il capitolo 11

`02-modellazione/capitolo-11-incremental-tables.md` è il soggetto del workflow
pilota della Fase 3. Dopo l'importazione l'applicazione ne conosce già: titolo,
numero, posizione, conteggio parole, blocchi di codice con linguaggio (`sqlx`,
`javascript`), figure, collegamenti esterni e segnaposto immagine.

Il testo originale è salvato come `chapter_versions` versione 1, `origin =
'original'`, protetto da trigger: la Fase 3 vi aggiungerà una proposta di
revisione senza toccarlo.

## 7. Limite noto

L'estrazione carica l'archivio interamente in memoria dentro una Route Handler
(`maxDuration = 300`). Per un archivio molto grande il tempo può non bastare:
l'errore viene registrato sulla fonte e l'importazione si può ripetere.

Nella **Fase 3** questo passaggio diventerà uno step di un workflow durevole, che
lavorerà a blocchi, sopravvivrà a un riavvio e potrà essere ripreso. La logica di
estrazione è già una funzione pura (`extractArchive`) proprio per rendere quel
passaggio una sostituzione di chiamante, non una riscrittura.
