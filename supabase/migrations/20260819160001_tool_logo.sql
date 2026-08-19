-- ---------------------------------------------------------------------------
-- Logo dello strumento oggetto del progetto
--
-- Il logo si carica in fase di input, accanto alle fonti: è il primo dato
-- visivo del progetto e serve alla copertina e alle anteprime dei corsi.
--
-- Non è un riferimento visuale come gli altri — quelli dicono «questo è il
-- registro», questo dice «questo è lo strumento» — e va composto tale e quale,
-- non ridisegnato. Distinguerlo con un valore proprio evita di doverlo
-- riconoscere dal nome del file, che è un modo per sbagliare.
-- ---------------------------------------------------------------------------

alter type asset_kind add value if not exists 'logo';
