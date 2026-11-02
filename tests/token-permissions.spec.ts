import { expect, test, type Page } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { chooseToken } from './support/connect';
import { installTauriMock } from './support/tauriMock';

/**
 * The permissions documented in docs/GITHUB_SETUP.md, in the order the panel
 * lists them (the doc orders them Metadata, Actions, Contents).
 */
const permissions = [
  'Actions Lesen/Schreiben',
  'Contents Lesen',
  'Metadata Lesen',
];

/** One line in the token step, linked to the field as its description. */
async function expectPermissions(page: Page, field: string) {
  const dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
  const list = dialog.getByRole('list', { name: 'Benötigte Rechte' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveText(permissions);
  await expect(dialog.getByLabel(field)).toHaveAccessibleDescription(
    /^Benötigte Rechte/,
  );
  const lines = await dialog
    .locator('.token-permissions')
    .evaluate((node) =>
      Math.round(
        node.getBoundingClientRect().height /
          parseFloat(getComputedStyle(node).lineHeight),
      ),
    );
  expect(lines).toBeLessThanOrEqual(2);
}

test('the native token path lists every permission the token needs', async ({
  page,
}) => {
  await installTauriMock(
    page,
    ({ fixture }) =>
      (cmd) =>
        cmd === 'snapshot'
          ? {
              ...fixture,
              accounts: [],
              repos: [],
              workflows: [],
              runs: [],
              pins: [],
              mode: 'live',
            }
          : null,
    { arg: { fixture }, state: {} },
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
    .click();
  await chooseToken(page);
  await expectPermissions(page, 'GitHub-Token');
});

test('the demo token step states the same permissions', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  await chooseToken(page);
  await expectPermissions(page, 'Beispiel-Token');
});
