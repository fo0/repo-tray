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
  await page.getByRole('button', { name: 'Neu konfigurieren' }).click();
  return page.getByRole('dialog', { name: 'Workflow starten' });
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
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
  return page.getByRole('dialog', { name: 'GitHub verbinden' });
}

/** A saved template card on the favorites tab, found by its heading. */
export function templateCard(page: Page, name: string) {
  return page.getByRole('article').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}
