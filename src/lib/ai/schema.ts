import { z } from 'zod';

/**
 * Traduzione degli schemi Zod in JSON Schema, per i provider che sanno
 * vincolare la generazione a una forma dichiarata.
 *
 * Serve a qualcosa di più che evitare un parsing fragile: senza schema il
 * modello deve indovinare la forma dal prompt, e i prompt degli agenti non la
 * descrivono. Dichiararla è la differenza fra un output conforme e uno
 * plausibile.
 */

/** JSON Schema equivalente, oppure `null` se lo schema non è traducibile. */
export function jsonSchemaFor(schema: z.ZodType<unknown>): Record<string, unknown> | null {
  let json: Record<string, unknown>;
  try {
    json = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
  } catch {
    return null;
  }
  delete json.$schema;
  return json;
}

/**
 * Schema in forma di oggetto, come richiesto da chi accetta soltanto oggetti.
 *
 * Uno schema di altra forma viene incapsulato in `{ valore: … }`; chi legge la
 * risposta deve riaprirlo, e `wrapped` dice quando farlo.
 */
export function objectSchemaFor(
  schema: z.ZodType<unknown>,
): { schema: Record<string, unknown>; wrapped: boolean } | null {
  const json = jsonSchemaFor(schema);
  if (!json) return null;
  if (json.type === 'object') return { schema: json, wrapped: false };
  return {
    schema: { type: 'object', properties: { valore: json }, required: ['valore'] },
    wrapped: true,
  };
}
