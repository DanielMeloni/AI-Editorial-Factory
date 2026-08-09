/** Prefissi delle rotte accessibili solo a utenti autenticati. */
export const PROTECTED_PREFIXES = ['/dashboard', '/projects', '/settings'] as const;

/** Rotte riservate agli utenti NON autenticati (login, registrazione, ...). */
export const AUTH_ONLY_PREFIXES = ['/login', '/register', '/forgot-password'] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isAuthOnlyPath(pathname: string): boolean {
  return AUTH_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Impedisce redirect verso domini esterni (open redirect). */
export function safeRedirectTarget(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}
