/**
 * Dichiarazioni per la parte pura dello script di allineamento dell'indice.
 *
 * Lo script è JavaScript perché viene eseguito con `node` senza compilazione.
 * Questo file esiste solo perché la logica che si può provare — la scelta delle
 * sitemap da leggere — sia richiamabile da un test in TypeScript.
 */

/** Sitemap annidate da scaricare: quelle che nominano il prodotto, o tutte. */
export function pickChildSitemaps(locations: string[]): string[];
