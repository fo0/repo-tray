import { expect, test } from './support/test';
import { connectDialog, connectToken } from './support/connect';
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
  downloadFail: boolean;
  downloadDelay: number;
  installFail: boolean;
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
            mode: 'install',
            version: '0.2.0',
            notes: 'Test-Changelog · nur IPC-Mock',
            date: '2026-11-01T09:05:00Z',
          };
        }
        if (cmd === 'download_update') {
          const progress = args?.onProgress as {
            onmessage: (value: unknown) => void;
          };
          progress.onmessage({
            downloaded: 5242880,
            total: 10485760,
            stage: 'downloading',
          });
          await new Promise((resolve) =>
            setTimeout(resolve, state.downloadDelay),
          );
          progress.onmessage({
            downloaded: 0,
            total: null,
            stage: 'verifying',
          });
          if (state.downloadFail)
            throw 'Signaturprüfung fehlgeschlagen. Es wurde nichts installiert.';
          return null;
        }
        if (cmd === 'install_update') {
          if (state.installFail)
            throw 'Installation konnte nicht gestartet werden.';
          return null;
        }
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
        return null;
      };
    },
    {
      arg: { fixture },
      state: {
        tokenDelay: 150,
        updateCheckError: false,
        updateCurrent: false,
        downloadFail: false,
        downloadDelay: 150,
        installFail: false,
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
  const dialog = connectDialog(page);
  await expect(
    dialog.getByRole('radio', { name: /^Mit GitHub anmelden/ }),
  ).toBeDisabled();
  await connectToken(page, 'synthetic-test-token');
  // Success closes the dialog by itself; the panel confirms it.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'demo-dev ist verbunden.' }),
  ).toBeVisible();
}
test('native token flow clears input, closes by itself and labels live mode', async ({
  page,
}) => {
  await login(page);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain('synthetic-test-token');
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
test('a delayed PAT login keeps focus on its busy button and is never cancelled by itself', async ({
  page,
}) => {
  await mock.configure({ tokenDelay: 600 });
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
    .click();
  await connectToken(page, 'synthetic-test-token');
  const busy = connectDialog(page).getByRole('button', {
    name: 'Wird geprüft …',
    exact: true,
  });
  await expect(busy).toBeDisabled();
  await expect(busy).toBeFocused();
  await expect(connectDialog(page).getByLabel('GitHub-Token')).toHaveValue('');
  const calls = await readCommands(page);
  expect(calls.filter((cmd) => cmd === 'connect_token')).toHaveLength(1);
  expect(calls).not.toContain('cancel_connect');
  expect(calls).not.toContain('discover_local_auth');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'demo-dev ist verbunden.' }),
  ).toBeVisible();
});
test('public update downloads inside the app and installs only after a separate confirmation', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  await page.getByRole('button', { name: 'Auf Updates prüfen' }).click();
  await expect(page.getByText('Test-Changelog · nur IPC-Mock')).toBeVisible();
  await mock.configure({ downloadDelay: 700 });
  await page
    .getByRole('button', { name: 'Update herunterladen', exact: true })
    .click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '50');
  await expect(
    page.getByRole('button', { name: 'Installieren und neu starten' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Dialog schließen' }).click();
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  const install = page.getByRole('button', {
    name: 'Installieren und neu starten',
  });
  await expect(install).toBeEnabled();
  const calls = await readCommands(page);
  expect(calls.filter((cmd) => cmd === 'download_update')).toHaveLength(1);
  expect(calls).not.toContain('install_update');
  expect(calls).not.toContain('open_update');
  await install.click();
  await expect
    .poll(async () =>
      (await readCommands(page)).filter((cmd) => cmd === 'install_update'),
    )
    .toHaveLength(1);
  await expect(
    page.getByRole('button', { name: 'Installation wird gestartet …' }),
  ).toBeDisabled();
});

test('a failed download never enables installation and can be retried', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  await mock.configure({ downloadFail: true });
  await page
    .getByRole('button', { name: 'Update herunterladen', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Es wurde nichts installiert',
  );
  await expect(
    page.getByRole('button', { name: 'Installieren und neu starten' }),
  ).toHaveCount(0);
  await mock.configure({
    downloadFail: false,
    installFail: true,
  });
  await page
    .getByRole('button', { name: 'Update herunterladen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Installieren und neu starten' })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Installation konnte nicht gestartet werden',
  );
  await expect(
    page.getByRole('button', { name: 'Installieren und neu starten' }),
  ).toBeEnabled();
});

test('failed update checks clear stale results and a successful retry can report current', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Update ansehen' }).click();
  await mock.configure({ updateCheckError: true });
  await page.getByRole('button', { name: 'Auf Updates prüfen' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Updateprüfung fehlgeschlagen',
  );
  await expect(
    page.getByRole('button', { name: 'Update herunterladen', exact: true }),
  ).toHaveCount(0);
  await mock.configure({
    updateCheckError: false,
    updateCurrent: true,
  });
  await page.getByRole('button', { name: 'Auf Updates prüfen' }).click();
  await expect(
    page.getByText('Du verwendest die aktuelle Version.'),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('update details and install confirmation fit a narrow panel', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await page.getByRole('button', { name: 'Update ansehen' }).click();
  await expect(page.getByRole('tab', { name: 'Updates' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const panel = page.getByRole('region', { name: 'RepoTray aktuell halten' });
  await expect(panel.getByText('Test-Changelog · nur IPC-Mock')).toBeVisible();
  expect(
    await panel.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('updates-available-360.png'),
  });
  await page
    .getByRole('button', { name: 'Update herunterladen', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Installieren und neu starten' }),
  ).toBeEnabled();
  expect(
    await panel.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('updates-ready-360.png') });
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
  await connectToken(page, 'invalid-synthetic-token');
  await expect(page.getByRole('alert')).toContainText('Token nicht bestätigt');
  await expect(page.getByLabel('GitHub-Token')).toHaveValue('');
  // The failed step stays open; „Zurück“ and „Abbrechen“ leave it.
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
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
