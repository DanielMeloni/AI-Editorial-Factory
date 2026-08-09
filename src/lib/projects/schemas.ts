import { z } from 'zod';

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
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
