import { describe, expect, it } from 'vitest';
import { isAuthOnlyPath, isProtectedPath, safeRedirectTarget } from '@/lib/auth/routes';

describe('isProtectedPath', () => {
  it('riconosce le rotte private esatte e le loro sottorotte', () => {
    expect(isProtectedPath('/dashboard')).toBe(true);
    expect(isProtectedPath('/projects')).toBe(true);
    expect(isProtectedPath('/projects/abc/chapters/11')).toBe(true);
    expect(isProtectedPath('/settings')).toBe(true);
  });

  it('non considera private le rotte pubbliche', () => {
    expect(isProtectedPath('/')).toBe(false);
    expect(isProtectedPath('/login')).toBe(false);
    expect(isProtectedPath('/auth/callback')).toBe(false);
  });

  it('non si lascia ingannare da prefissi simili', () => {
    expect(isProtectedPath('/projects-pubblici')).toBe(false);
    expect(isProtectedPath('/dashboards')).toBe(false);
  });
});

describe('isAuthOnlyPath', () => {
  it('riconosce le pagine riservate agli utenti non autenticati', () => {
    expect(isAuthOnlyPath('/login')).toBe(true);
    expect(isAuthOnlyPath('/register')).toBe(true);
    expect(isAuthOnlyPath('/forgot-password')).toBe(true);
  });

  it('esclude reset-password, raggiungibile solo con una sessione attiva', () => {
    expect(isAuthOnlyPath('/reset-password')).toBe(false);
  });
});

describe('safeRedirectTarget', () => {
  it('accetta soltanto percorsi relativi', () => {
    expect(safeRedirectTarget('/projects/123')).toBe('/projects/123');
  });

  it('blocca i redirect verso domini esterni', () => {
    expect(safeRedirectTarget('https://esempio-malevolo.test')).toBe('/dashboard');
    expect(safeRedirectTarget('//esempio-malevolo.test')).toBe('/dashboard');
  });

  it('usa il fallback su valori vuoti o assenti', () => {
    expect(safeRedirectTarget(null)).toBe('/dashboard');
    expect(safeRedirectTarget(undefined)).toBe('/dashboard');
    expect(safeRedirectTarget('')).toBe('/dashboard');
    expect(safeRedirectTarget('', '/settings')).toBe('/settings');
  });
});
