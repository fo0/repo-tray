import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { installTauriMock } from './support/tauriMock';

/** The permissions documented in docs/GITHUB_SETUP.md, in the same order. */
const permissions = [
  'Actions: Lesen und Schreiben',
  'Contents: Lesen',
  'Metadata: Lesen',
];

async function expectPermissions(page: Page) {
  const list = page
    .getByRole('dialog', { name: 'GitHub verbinden' })
    .getByRole('list', { name: /Benötigte Rechte/ });
  await expect(list).toBeVisible();
  await expect(list.getByRole('listitem').locator('strong')).toHaveText(
    permissions,
  );
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
  await expectPermissions(page);
});

test('the demo „Token hinterlegen“ disclosure states the same permissions', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  await page.getByText('Alternativ: Token hinterlegen').click();
  await expectPermissions(page);
});
