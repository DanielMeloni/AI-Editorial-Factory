import { z } from 'zod';
import { LIVELLI, REGISTRI, TONI } from '@/lib/editorial/direzione';
import { FORME } from '@/lib/editorial/brief';

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export const createProjectSchema = z.object({
  title: z.string().trim().min(2, 'Il titolo deve avere almeno 2 caratteri').max(200),
  subtitle: z.string().trim().max(300).optional().or(z.literal('')),
  author: z.string().trim().max(200).optional().or(z.literal('')),
  volume: z.string().trim().max(100).optional().or(z.literal('')),
  language: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$/, 'Usa un codice lingua di due lettere, ad esempio "it"')
    .default('it'),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  // I valori ammessi nascono dal vocabolario editoriale, non da un elenco
  // ricopiato: aggiungerne uno là lo rende valido qui, e viceversa.
  level: z.enum(LIVELLI.map((voce) => voce.value) as [string, ...string[]]).default('base'),
  tone: z.enum(TONI.map((voce) => voce.value) as [string, ...string[]]).default('didattico'),
  register: z
    .enum(REGISTRI.map((voce) => voce.value) as [string, ...string[]])
    .default('tecnico_operativo'),
  styleNotes: z.string().trim().max(2000).optional().or(z.literal('')),
  // Brief: cosa si sta costruendo, non come lo si scrive.
  workShape: z
    .enum(FORME.map((voce) => voce.value) as [string, ...string[]])
    .default('volume_singolo'),
  // Vuoto significa «nessun vincolo di lunghezza»: il campo resta facoltativo
  // perché imporre un numero a chi non ce l'ha lo farebbe inventare.
  targetPages: z
    .union([z.coerce.number().int().min(8).max(2000), z.literal('')])
    .optional(),
  scope: z.string().trim().max(3000).optional().or(z.literal('')),
  outOfScope: z.string().trim().max(2000).optional().or(z.literal('')),
  audience: z.string().trim().max(1000).optional().or(z.literal('')),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
