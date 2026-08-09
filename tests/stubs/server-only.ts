/**
 * Sostituto di `server-only` nei test.
 *
 * Il pacchetto reale lancia un'eccezione quando viene importato in un contesto
 * client, e l'ambiente jsdom di Vitest è considerato tale. In produzione la
 * protezione resta intatta: qui viene neutralizzata solo per poter collaudare i
 * moduli server.
 */
export {};
