'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { type ActionState, toFieldErrors } from '@/lib/auth/action-state';
import { safeRedirectTarget } from '@/lib/auth/routes';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@/lib/auth/schemas';

/** Origine assoluta della richiesta, per i link inviati via email. */
async function getOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, '');

  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000';
  const protocol = headerList.get('x-forwarded-proto') ?? 'http';
  return `${protocol}://${host}`;
}

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    redirectTo: formData.get('redirectTo') ?? undefined,
  });

  if (!parsed.success) {
    return { status: 'error', message: 'Controlla i campi evidenziati.', fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Messaggio volutamente generico: non rivelare se l'email esiste.
    return { status: 'error', message: 'Credenziali non valide oppure email non ancora confermata.' };
  }

  revalidatePath('/', 'layout');
  redirect(safeRedirectTarget(parsed.data.redirectTo));
}

export async function register(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return { status: 'error', message: 'Controlla i campi evidenziati.', fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const origin = await getOrigin();

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return { status: 'error', message: 'Registrazione non riuscita. Riprova tra qualche istante.' };
  }

  return {
    status: 'success',
    message:
      'Registrazione ricevuta. Ti abbiamo inviato un messaggio: conferma l’indirizzo email per accedere.',
  };
}

export async function forgotPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });

  if (!parsed.success) {
    return { status: 'error', fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const origin = await getOrigin();

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  // Risposta identica in ogni caso: non rivelare quali email sono registrate.
  return {
    status: 'success',
    message: 'Se l’indirizzo è registrato, riceverai un messaggio con le istruzioni.',
  };
}

export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return { status: 'error', fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return {
      status: 'error',
      message: 'Impossibile aggiornare la password. Il link potrebbe essere scaduto.',
    };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();

  const parsed = updateProfileSchema.safeParse({ fullName: formData.get('fullName') });
  if (!parsed.success) {
    return { status: 'error', fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    data: { full_name: parsed.data.fullName },
  });

  if (error) {
    return { status: 'error', message: 'Aggiornamento non riuscito.' };
  }

  revalidatePath('/settings');
  return { status: 'success', message: 'Profilo aggiornato.' };
}

export async function logout(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
