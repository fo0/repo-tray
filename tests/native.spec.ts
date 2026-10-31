import { expect, test } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ fixture }) => {
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
      const calls: string[] = [];
      let callback = 0;
      let authGeneration = 0;
      const internal = {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          calls.push(cmd);
          if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
            return structuredClone(snapshot);
          if (cmd === 'connect_token') {
            const ticket = ++authGeneration;
            if (args?.token !== 'synthetic-test-token')
              throw 'GitHub hat den Token nicht bestätigt.';
            const delay =
              (window as unknown as { __nativeTokenDelay?: number })
                .__nativeTokenDelay ?? 150;
            await new Promise((resolve) => setTimeout(resolve, delay));
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
          if (cmd === 'check_update')
            return {
              version: '0.2.0',
              notes: 'Test-Changelog · nur IPC-Mock',
              downloadUrl:
                'https://github.com/fo0/repo-tray/releases/download/v0.2.0/RepoTray_0.2.0_x64-setup.exe',
            };
          if (cmd === 'open_update') return null;
          if (cmd === 'select_repos') return structuredClone(snapshot);
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
          if (cmd === 'plugin:event|listen') return ++callback;
          return null;
        },
        transformCallback: () => ++callback,
        unregisterCallback: () => {},
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { label: 'main', windowLabel: 'main' },
        },
      };
      Object.assign(window, {
        isTauri: true,
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        __TAURI_INTERNALS__: internal,
        __nativeCalls: calls,
      });
    },
    { fixture },
  );
  await page.goto('/');
});
async function login(page: import('@playwright/test').Page) {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
  await expect(
    dialog.getByRole('button', { name: /Mit GitHub anmelden/ }),
  ).toBeDisabled();
  await dialog.getByLabel('GitHub-Token').fill('synthetic-test-token');
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(dialog.getByLabel('GitHub-Token')).toHaveValue('');
  await expect(
    page.getByRole('heading', { name: 'Dein Workspace', exact: true }),
  ).toBeVisible();
}
test('native token flow clears input, labels live mode and returns to repository setup', async ({
  page,
}) => {
  await login(page);
  await expect(
    page.getByText('1 Konten verbunden', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain('synthetic-test-token');
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(
    page.getByRole('status', { name: 'Verbindungsstatus' }),
  ).toContainText('GitHub');
  await expect(
    page.getByRole('status', { name: 'Verbindungsstatus' }),
  ).not.toContainText('Demo');
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await page.getByRole('button', { name: 'Neu konfigurieren' }).click();
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
  await page.evaluate(() => Object.assign(window, { __nativeTokenDelay: 600 }));
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
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
  const calls = await page.evaluate(
    () => (window as unknown as { __nativeCalls: string[] }).__nativeCalls,
  );
  expect(calls.filter((cmd) => cmd === 'connect_token')).toHaveLength(1);
  expect(calls).not.toContain('cancel_connect');
  expect(calls).not.toContain('discover_local_auth');
  await expect(
    page.getByRole('heading', { name: 'Dein Workspace', exact: true }),
  ).toBeVisible();
});
test('unsigned update shows changelog and opens only an explicit manual EXE download', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Auf Updates prüfen' }).click();
  await expect(page.getByText('Test-Changelog · nur IPC-Mock')).toBeVisible();
  await page
    .getByRole('button', { name: 'EXE im Browser herunterladen' })
    .click();
  await expect(
    page.getByText(/Starte die EXE nach dem Herunterladen manuell/),
  ).toBeVisible();
  const calls = await page.evaluate(
    () => (window as unknown as { __nativeCalls: string[] }).__nativeCalls,
  );
  expect(calls).toContain('open_update');
  expect(calls).not.toContain('install_update');
});
test('native invalid token is rejected and disconnect removes the account view', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
  await page.getByLabel('GitHub-Token').fill('invalid-synthetic-token');
  await page
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(page.getByRole('alert')).toContainText('Token nicht bestätigt');
  await expect(page.getByLabel('GitHub-Token')).toHaveValue('');
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await login(page);
  await page.getByRole('button', { name: /^demo-dev.*trennen$/ }).click();
  await expect(
    page.getByText('0 Konten verbunden', { exact: true }),
  ).toBeVisible();
});
