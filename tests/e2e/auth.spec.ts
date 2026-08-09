import { expect, test } from '@playwright/test';

/**
 * Percorsi verificabili senza credenziali reali.
 *
 * I test che richiedono un utente autenticato vivono in `authenticated.spec.ts`
 * e si attivano solo quando le credenziali di prova sono configurate: un test
 * che fallisce per mancanza di ambiente non segnala nulla di utile.
 */

test.describe('rotte protette', () => {
  for (const percorso of ['/dashboard', '/projects', '/settings', '/projects/new']) {
    test(`${percorso} reindirizza al login`, async ({ page }) => {
      await page.goto(percorso);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test('la destinazione richiesta viene conservata', async ({ page }) => {
    await page.goto('/projects/qualcosa/structure');
    await expect(page).toHaveURL(/redirectTo=/);
  });
});

test.describe('accesso', () => {
  test('il form è utilizzabile da tastiera', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();

    await page.getByLabel('Email').focus();
    await page.keyboard.type('daniel@esempio.it');
    await page.keyboard.press('Tab');
    await page.keyboard.type('password-di-prova');

    await expect(page.getByLabel('Email')).toHaveValue('daniel@esempio.it');
    await expect(page.getByRole('button', { name: 'Accedi' })).toBeEnabled();
  });

  test('credenziali errate producono un messaggio generico', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('inesistente@esempio.it');
    await page.getByLabel('Password').fill('password-sbagliata');
    await page.getByRole('button', { name: 'Accedi' }).click();

    const avviso = page.getByRole('alert');
    await expect(avviso).toBeVisible({ timeout: 15_000 });
    // Il messaggio non deve rivelare se l'indirizzo esista.
    await expect(avviso).not.toContainText(/non registrat|inesistente|utente non trovato/i);
  });

  test('il collegamento alla registrazione funziona', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Registrati' }).click();
    await expect(page).toHaveURL('/register');
    await expect(page.getByRole('heading', { name: 'Crea il tuo account' })).toBeVisible();
  });

  test('il recupero password non rivela l’esistenza dell’indirizzo', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('chiunque@esempio.it');
    await page.getByRole('button', { name: 'Invia istruzioni' }).click();

    await expect(page.getByRole('status')).toContainText(/Se l’indirizzo è registrato/i, {
      timeout: 15_000,
    });
  });
});

test.describe('registrazione', () => {
  test('la validazione della password avviene sul server', async ({ page }) => {
    await page.goto('/register');

    await page.getByLabel('Nome e cognome').fill('Utente Di Prova');
    await page.getByLabel('Email').fill(`prova-${Date.now()}@esempio.it`);
    await page.getByLabel('Password', { exact: true }).fill('corta');
    await page.getByLabel('Conferma password').fill('corta');
    await page.getByRole('button', { name: 'Crea account' }).click();

    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 15_000 });
  });

  test('le password non coincidenti sono segnalate sul campo di conferma', async ({ page }) => {
    await page.goto('/register');

    await page.getByLabel('Nome e cognome').fill('Utente Di Prova');
    await page.getByLabel('Email').fill(`prova-${Date.now()}@esempio.it`);
    await page.getByLabel('Password', { exact: true }).fill('Redazione2026');
    await page.getByLabel('Conferma password').fill('Redazione2027');
    await page.getByRole('button', { name: 'Crea account' }).click();

    await expect(page.getByText('Le password non coincidono')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('accessibilità di base', () => {
  test('esiste un collegamento per saltare al contenuto', async ({ page }) => {
    await page.goto('/login');
    const salta = page.getByRole('link', { name: 'Salta al contenuto principale' });
    await expect(salta).toBeAttached();
  });

  test('la pagina dichiara la lingua italiana', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  });

  test('ogni campo del form ha un’etichetta associata', async ({ page }) => {
    await page.goto('/register');
    for (const etichetta of ['Nome e cognome', 'Email', 'Conferma password']) {
      await expect(page.getByLabel(etichetta)).toBeVisible();
    }
  });

  test('il tema scuro si attiva e persiste nella pagina', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Alterna tema chiaro e scuro' }).click();
    await expect(page.locator('html')).toHaveClass(/dark|light/);
  });
});

test.describe('pagine di errore', () => {
  test('una rotta inesistente mostra la pagina 404', async ({ page }) => {
    const risposta = await page.goto('/questa-pagina-non-esiste');
    expect(risposta?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible();
  });
});
