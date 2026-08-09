import { z } from 'zod';

// L'ordine conta: prima si normalizza (trim + minuscolo), poi si valida.
// Invertendolo, "  Daniel@Esempio.IT " verrebbe rifiutato per gli spazi.
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Inserisci un indirizzo email valido' }));

export const passwordSchema = z
  .string()
  .min(10, 'La password deve contenere almeno 10 caratteri')
  .max(72, 'La password non può superare i 72 caratteri')
  .refine((value) => /[a-z]/.test(value), 'Serve almeno una lettera minuscola')
  .refine((value) => /[A-Z]/.test(value), 'Serve almeno una lettera maiuscola')
  .refine((value) => /\d/.test(value), 'Serve almeno una cifra');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Inserisci la password'),
  redirectTo: z.string().optional(),
});

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Inserisci il tuo nome').max(120),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Le password non coincidono',
    path: ['confirmPassword'],
  });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Le password non coincidono',
    path: ['confirmPassword'],
  });

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Inserisci il tuo nome').max(120),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
