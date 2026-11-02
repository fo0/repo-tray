import { expect, type Page } from '@playwright/test';

/** The open connection dialog („GitHub verbinden“). */
export function connectDialog(page: Page) {
  return page.getByRole('dialog', { name: 'GitHub verbinden', exact: true });
}

/** Picks „Mit Token verbinden“ in the method step and goes on to its form. */
export async function chooseToken(page: Page) {
  const dialog = connectDialog(page);
  await dialog.getByRole('radio', { name: /^Mit Token verbinden/ }).check();
  await dialog.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Mit Token verbinden' }),
  ).toBeVisible();
}

/**
 * Connects through the token step of the open connection dialog; `label`
 * names the field („Beispiel-Token“ in the browser demo).
 */
export async function connectToken(
  page: Page,
  token: string,
  label = 'GitHub-Token',
) {
  await chooseToken(page);
  const dialog = connectDialog(page);
  await dialog.getByLabel(label).fill(token);
  await dialog.getByRole('button', { name: 'Verbinden', exact: true }).click();
}

/** Starts the local sign-in check from the method step. */
export async function checkLocal(page: Page) {
  const dialog = connectDialog(page);
  await dialog
    .getByRole('radio', {
      name: /^Bestehende Anmeldung auf diesem PC verwenden/,
    })
    .check();
  await dialog
    .getByRole('button', { name: 'Lokale Anmeldung prüfen', exact: true })
    .click();
}
