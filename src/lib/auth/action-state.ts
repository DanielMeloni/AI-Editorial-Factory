import type { z } from 'zod';

/**
 * Stato restituito dalle Server Action ai form.
 * Vive in un modulo separato perché un file "use server" può esportare
 * soltanto funzioni asincrone.
 */
export interface ActionState {
  status: 'idle' | 'error' | 'success';
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const initialActionState: ActionState = { status: 'idle' };

/** Riduce gli issue di Zod a una mappa campo -> primo messaggio. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (key && !result[key]) result[key] = issue.message;
  }
  return result;
}
