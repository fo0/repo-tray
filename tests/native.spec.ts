import { expect, test } from './support/test';
import { openPage } from './support/demo';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import {
  type TauriMock,
  installTauriMock,
  readCommands,
} from './support/tauriMock';

type NativeMock = {
  tokenDelay: number;
  updateCheckError: boolean;
  updateCurrent: boolean;
};
let mock: TauriMock<NativeMock>;

test.beforeEach(async ({ page }) => {
  mock = await installTauriMock<{ fixture: typeof fixture }, NativeMock>(
    page,
    ({ fixture }, state) => {
      let snapshot: typeof fixture = {
        ...structuredClone(fixture),
        accounts: [],
        repos: [],
        workflows: [],
        runs: [],
        pins: [],
        mode: 'live',
        stale: false,
        connectivity: 'online',
      };
      let authGeneration = 0;
      return async (cmd, args) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(snapshot);
        if (cmd === 'connect_token') {
          const ticket = ++authGeneration;
          if (args?.token !== 'synthetic-test-token')
            throw 'GitHub hat den Token nicht bestätigt.';
          await new Promise((resolve) => setTimeout(resolve, state.tokenDelay));
          if (ticket !== authGeneration) throw 'Anmeldung wurde abgebrochen.';
          snapshot = {
            ...structuredClone(fixture),
            mode: 'live',
            accounts: fixture.accounts.slice(0, 1),
            repos: fixture.repos.filter(
              (repo) => repo.accountId === 'demo-personal',
            ),
            stale: false,
            connectivity: 'online',
          };
          return structuredClone(snapshot);
        }
        if (cmd === 'cancel_connect') {
          authGeneration++;
          return null;
        }
        if (cmd === 'check_update') {
          if (state.updateCheckError)
            throw 'Updateprüfung fehlgeschlagen. Prüfe die Verbindung.';
          if (state.updateCurrent) return null;
          return {
            version: '0.2.0',
            notes: '* Test-Changelog · nur IPC-Mock',
            date: '2026-11-01T09:05:00Z',
          };
        }
        if (cmd === 'disconnect_account') {
          snapshot = {
            ...snapshot,
            accounts: [],
            repos: [],
            workflows: [],
            runs: [],
            pins: [],
          };
          return structuredClone(snapshot);
        }
        return null;
      };
    },
    {
      arg: { fixture },
      state: {
        tokenDelay: 150,
        updateCheckError: false,
        updateCurrent: false,
      },
    },
  );
  await page.goto('/');
});
async function login(page: import('@playwright/test').Page) {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
  await expect(
    dialog.getByRole('button', { name: /Mit GitHub anmelden/ }),
  ).toBeDisabled();
  await dialog.getByLabel('GitHub-Token').fill('synthetic-test-token');
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(dialog.getByLabel('GitHub-Token')).toHaveValue('');
  await connectedOnOverview(page);
}
/** A new account closes every dialog and lands on the overview with one notice. */
async function connectedOnOverview(page: import('@playwright/test').Page) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.tray')).toHaveAttribute('data-page', 'overview');
  await expect(
    page.getByRole('status').filter({ hasText: 'Konto demo-dev verbunden.' }),
  ).toBeVisible();
}
test('native token flow clears input, labels live mode and lands on the overview', async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await expect(
    page.getByText('1 Konto verbunden', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain('synthetic-test-token');
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'Verbindungsstatus' }),
  ).toContainText('GitHub');
  await expect(
    page.getByRole('status', { name: 'Verbindungsstatus' }),
  ).not.toContainText('Demo');
  await openPage(page, 'favorites');
  await page
    .getByRole('button', { name: 'Workflow starten …', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Workflow starten', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText('Echter GitHub-Workflow-Start · Konto und Ziel prüfen'),
  ).toBeVisible();
});
test('a delayed PAT login keeps idle local auth mounted and cannot be cancelled by its cleanup', async ({
  page,
}) => {
  await mock.configure({ tokenDelay: 600 });
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
    .click();
  await page
    .getByText('Bestehende Anmeldung auf diesem PC verwenden', { exact: true })
    .click();
  const scan = page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' });
  await expect(scan).toBeEnabled();
  await page.getByLabel('GitHub-Token').fill('synthetic-test-token');
  await page
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(scan).toBeDisabled();
  const calls = await readCommands(page);
  expect(calls.filter((cmd) => cmd === 'connect_token')).toHaveLength(1);
  expect(calls).not.toContain('cancel_connect');
  expect(calls).not.toContain('discover_local_auth');
  await connectedOnOverview(page);
});
test('failed update checks clear stale results and a successful retry can report current', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Ansehen', exact: true }).click();
  await expect(page.getByText('Test-Changelog · nur IPC-Mock')).toBeVisible();
  await mock.configure({ updateCheckError: true });
  await page.getByRole('button', { name: 'Nach Updates suchen' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Updateprüfung fehlgeschlagen',
  );
  await expect(
    page.getByRole('button', { name: 'Installieren', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('Test-Changelog · nur IPC-Mock')).toHaveCount(0);
  await mock.configure({
    updateCheckError: false,
    updateCurrent: true,
  });
  await page.getByRole('button', { name: 'Nach Updates suchen' }).click();
  await expect(page.getByText('Aktuell.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('native invalid token is rejected and disconnect removes the account view', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
    .click();
  await page.getByLabel('GitHub-Token').fill('invalid-synthetic-token');
  await page
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(page.getByRole('alert')).toContainText('Token nicht bestätigt');
  await expect(page.getByLabel('GitHub-Token')).toHaveValue('');
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await login(page);
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: /^demo-dev.*trennen$/ }).click();
  await page
    .getByRole('group', { name: /^demo-dev · .+ trennen\?$/ })
    .getByRole('button', { name: 'Trennen', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Noch kein Konto verbunden' }),
  ).toBeVisible();
});
