import { expect, test } from '@playwright/test';

/**
 * Percorso completo con un utente reale.
 *
 * Richiede un progetto Supabase con le migration applicate e un utente di prova
 * già confermato, indicati da variabili di ambiente:
 *
 *     E2E_EMAIL=...  E2E_PASSWORD=...  npm run test:e2e
 *
 * Senza credenziali i test vengono saltati con un motivo esplicito: un test che
 * fallisce per mancanza di ambiente non segnala nulla di utile e insegna a
 * ignorare il rosso.
 */

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(
  !EMAIL || !PASSWORD,
  'Credenziali di prova assenti: impostare E2E_EMAIL e E2E_PASSWORD.',
);

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL!);
  await page.getByLabel('Password').fill(PASSWORD!);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
});

test('la dashboard mostra le sezioni previste', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Progetti recenti')).toBeVisible();
  await expect(page.getByText('Revisioni in attesa')).toBeVisible();
});

test('si può creare un progetto e raggiungerne le schede', async ({ page }) => {
  const titolo = `Progetto di prova ${Date.now()}`;

  await page.goto('/projects/new');
  await page.getByLabel('Titolo dell’opera').fill(titolo);
  await page.getByLabel('Autore').fill('Utente Di Prova');
  await page.getByRole('button', { name: 'Crea progetto' }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: titolo })).toBeVisible();

  for (const scheda of ['Fonti', 'Struttura', 'Workflow', 'Revisioni', 'Visual', 'Copertina', 'Pubblicazioni']) {
    await expect(page.getByRole('link', { name: scheda })).toBeVisible();
  }
});

test('il Cover Studio calcola il dorso e lo dichiara definitivo', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('link').first().click();
  await page.getByRole('link', { name: 'Copertina' }).click();

  await page.getByLabel('Numero di pagine').fill('320');
  await page.getByLabel('Fattore').fill('0.1');

  await expect(page.getByText('Dorso: 32 mm')).toBeVisible();
  await expect(page.getByText('dorso definitivo')).toBeVisible();
});

test('il logout riporta al login e revoca l’accesso', async ({ page }) => {
  await page.getByRole('button', { name: 'Esci dall’applicazione' }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
