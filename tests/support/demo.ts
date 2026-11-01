import { expect, type Page } from '@playwright/test';

/** Loads the browser demo and switches to the activity tab. */
export async function openDemoActivity(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /RepoTray/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: /^Aktivität/ }).click();
}

/** Opens a fresh launch dialog from the favorites tab. */
export async function openLaunch(page: Page) {
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await page
    .locator('.workflow-heading')
    .getByRole('button', { name: 'Starten…', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Workflow starten' });
}

/** The header button that opens the account menu. */
export function accountMenuButton(page: Page) {
  return page.getByRole('button', { name: / – Konto wechseln$/ });
}

/**
 * Picks an account in the header account menu by its shown name, e.g.
 * `team-demo` or `Alle Konten` in the demo.
 */
export async function chooseAccount(page: Page, name: string) {
  await accountMenuButton(page).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/** Switches the demo scenario in settings and closes the dialog again. */
export async function scenario(page: Page, value: string) {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByLabel('Demo-Szenario').selectOption(value);
  await page.getByRole('button', { name: 'Dialog schließen' }).click();
}

/** Opens the demo connection dialog via settings. */
export async function openConnection(page: Page) {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'GitHub verbinden' });
}

/** A saved template card on the favorites tab, found by its heading. */
export function templateCard(page: Page, name: string) {
  return page.getByRole('article').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}
