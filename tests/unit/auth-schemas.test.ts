import { describe, expect, it } from 'vitest';
import {
  forgotPasswordSchema,
  loginSchema,
  passwordSchema,
  registerSchema,
} from '@/lib/auth/schemas';

describe('passwordSchema', () => {
  it('accetta una password conforme', () => {
    expect(passwordSchema.safeParse('Redazione2026').success).toBe(true);
  });

  it.each([
    ['Corta1A', 'meno di 10 caratteri'],
    ['tuttominuscolo1', 'senza maiuscole'],
    ['TUTTOMAIUSCOLO1', 'senza minuscole'],
    ['SenzaCifreQui', 'senza cifre'],
  ])('rifiuta %s (%s)', (value) => {
    expect(passwordSchema.safeParse(value).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('normalizza l’email in minuscolo e senza spazi', () => {
    const result = loginSchema.safeParse({ email: '  Daniel@Esempio.IT ', password: 'x' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('daniel@esempio.it');
  });

  it('rifiuta un’email malformata', () => {
    expect(loginSchema.safeParse({ email: 'non-una-email', password: 'x' }).success).toBe(false);
  });
});

describe('registerSchema', () => {
  const valid = {
    fullName: 'Daniel Meloni',
    email: 'daniel@esempio.it',
    password: 'Redazione2026',
    confirmPassword: 'Redazione2026',
  };

  it('accetta un input completo e coerente', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it('segnala le password non coincidenti sul campo di conferma', () => {
    const result = registerSchema.safeParse({ ...valid, confirmPassword: 'Altra2026Password' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['confirmPassword']);
    }
  });
});

describe('forgotPasswordSchema', () => {
  it('richiede un’email valida', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'daniel@esempio.it' }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: 'vuoto' }).success).toBe(false);
  });
});
