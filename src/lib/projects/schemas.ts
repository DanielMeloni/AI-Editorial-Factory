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
  volumeCount: z.coerce.number().int().min(1, 'Inserisci almeno un volume').max(20, 'Massimo 20 volumi iniziali').default(1),
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
  audienceGoal: z.string().trim().max(2000).optional().or(z.literal('')),
  allowedPrerequisites: z.string().trim().max(3000).optional().or(z.literal('')),
  jargonBudget: z.coerce.number().int().min(0).max(100).default(5),
  quickWinMaxPages: z.coerce.number().int().min(1).max(200).default(25),
  advancedContentPolicy: z.enum(['inline', 'callout', 'appendix', 'next_volume']).default('appendix'),
  requireUiScreenshots: z.boolean().default(true),
  requireExpectedStateVisuals: z.boolean().default(true),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
