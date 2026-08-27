# Hardening editoriale 1.1

> Stato: fondamenta P0 implementate il 27 agosto 2026. Il golden sample dei
> primi sette capitoli resta da correggere e approvare prima della generazione
> in scala del pilota.

## Confine di pubblicazione

Il formatter usa una whitelist positiva. Riceve soltanto:

- `manuscript_content` approvato;
- `approved_asset` approvati;
- `publication_metadata` approvati.

`qa_metadata`, `evidence`, `internal_notes` e `visual_spec` non entrano nel
payload. La funzione `buildFormatterPayload()` fallisce se manca il manoscritto,
se ce n'è più di uno o se un artefatto pubblicabile non è approvato.

## Gate deterministici

`src/lib/editorial-quality/` contiene controlli provider-agnostic:

1. **Leakage Guard** — blocca marker interni, residui di navigazione, TODO,
   metadati agentici, URL grezzi e testo dichiarato troncato.
2. **Chapter Completeness** — confronta blueprint e sezioni reali, blocca
   capitoli troppo corti, sezioni sottili e fallback di fonte.
3. **Audience Fit** — richiede un profilo strutturato e applica il budget di
   tecnicismi per i lettori beginner.
4. **Entity Consistency** — blocca alias vietati e indica il nome canonico.
5. **Visual QA** — richiede approvazione, alt text e label non tronche.
6. **Publication Preflight** — aggrega gli esiti e restituisce `publishable` o
   uno stato `needs_*_fix`.

I gate non correggono automaticamente i match. Restituiscono posizione,
codice, messaggio ed estratto per la revisione.

## Workflow

La stesura multi-passaggio registra:

- la versione come `manuscript_content`;
- Leakage, Completeness e Audience Fit in `quality_gate_results`;
- il piano visuale come `visual_spec`, separato dal manoscritto.

L'export richiede contemporaneamente capitolo approvato, versione approvata,
audience profile valido, manoscritto senza issue bloccanti e soli asset visuali
approvati. Il controllo precedente, che in alcuni casi lasciava esportare una
versione non esplicitamente approvata, è stato rimosso.

## Dati

La migration `20260827090001_editorial_quality_hardening.sql` aggiunge:

- `projects.audience_profile` e l'override sui volumi;
- `chapter_versions.artifact_kind` vincolato a `manuscript_content`;
- `editorial_artifacts` con tipo immutabile e promozione esplicita;
- `project_entities`;
- `quality_gate_results` con override motivato;
- `render_snapshots`;
- `golden_samples`.
- `exports.preflight_status` e metadati di ruolo/provenienza su `visual_assets`.

Tutte le nuove tabelle hanno RLS abilitata e forzata.

## Operatività completata

- Il preflight gira sui byte del PDF finale: controlla leakage, pagine vuote,
  glifi mancanti e overflow, poi persiste checksum e impronte pagina in
  `render_snapshots`. Il download si abilita solo dopo il superamento.
- La scheda **Qualità** gestisce Entity Registry, override motivati, snapshot e
  promozione a golden sample. Le build successive mostrano le pagine cambiate.
- Visual Studio acquisisce schermate reali con ruolo `procedure` o `result`,
  didascalia e alt text; restano in attesa di approvazione.

## Attività editoriale umana

I primi sette capitoli del pilota devono essere corretti, approvati ed
esplicitamente promossi a golden sample da un revisore. È una decisione
editoriale e non viene automatizzata dal sistema.
