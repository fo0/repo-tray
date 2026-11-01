import { expect, test } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import {
  configureMock,
  installTauriMock,
  readCalls,
  readMockState,
} from './support/tauriMock';

type LocalMock = {
  scanDelay: number;
  empty: boolean;
  /** Rejects discovery or the import with this IPC error when set. */
  scanError: string;
  importError: string;
  /** Counts discovery responses after the panel had a full task to apply them. */
  scansSettled: number;
};

test.beforeEach(async ({ page }) => {
  await installTauriMock<{ fixture: typeof fixture }, LocalMock>(
    page,
    ({ fixture }, state) => {
      const empty = {
        ...structuredClone(fixture),
        accounts: [],
        repos: [],
        workflows: [],
        runs: [],
        pins: [],
        mode: 'live',
        connectivity: 'online',
        stale: false,
      };
      const accounts = [
        {
          source: 'gh',
          host: 'github.com',
          login: 'fixture-alex',
          usable: true,
          active: true,
          detail: 'API-Anmeldung bestätigt',
          actionsRead: 'Scope repo vorhanden; Repository-Zugriff ungeprüft.',
          actionsWrite: 'Actions starten: pro Repository ungeprüft.',
        },
        {
          source: 'gh',
          host: 'github.com',
          login: 'fixture-sam',
          usable: true,
          active: false,
          detail: 'API-Anmeldung bestätigt',
          actionsRead: 'Scopes nicht auslesbar.',
          actionsWrite: 'Actions starten: pro Repository ungeprüft.',
        },
        {
          source: 'gcm',
          host: 'github.com',
          login: 'fixture-gcm',
          usable: false,
          active: false,
          detail: 'Git-Konto; API-Übernahme nicht unterstützt.',
          actionsRead: 'Git belegt keine Actions-API-Rechte.',
          actionsWrite: 'Nicht nachgewiesen.',
        },
      ];
      return async (cmd, args) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(empty);
        if (cmd === 'discover_local_auth') {
          await new Promise((resolve) => setTimeout(resolve, state.scanDelay));
          if (state.scanError) throw state.scanError;
          // Count it one task later, once the panel has consumed the result.
          setTimeout(() => state.scansSettled++, 0);
          return {
            accounts: state.empty ? [] : accounts,
            notices: [
              'Git erkannt; keine API-Anmeldung belegt.',
              'GCM-Credentials werden nicht exportiert.',
            ],
          };
        }
        if (cmd === 'connect_local_auth') {
          if (args?.login !== 'fixture-sam' || args?.confirmImport !== true)
            throw 'Selection mismatch';
          if (state.importError) throw state.importError;
          return {
            ...structuredClone(fixture),
            mode: 'live',
            connectivity: 'online',
            stale: false,
            accounts: [
              {
                id: 'github-gh-42',
                login: 'fixture-sam',
                label: 'GitHub · gh CLI (Kopie)',
              },
            ],
          };
        }
        return null;
      };
    },
    {
      arg: { fixture },
      state: {
        scanDelay: 0,
        empty: false,
        scanError: '',
        importError: '',
        scansSettled: 0,
      },
    },
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
    .click();
});

test('local account access requires a click, explicit choice and consent before secret import', async ({
  page,
}) => {
  const calls = () => readCalls(page);
  expect((await calls()).some((c) => c.cmd.includes('local_auth'))).toBe(false);
  await page
    .getByText('Bestehende Anmeldung auf diesem PC verwenden', { exact: true })
    .click();
  expect((await calls()).some((c) => c.cmd.includes('local_auth'))).toBe(false);
  await page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }).click();
  const select = page.getByLabel('Lokales Konto · gh CLI');
  await expect(select).toHaveValue('');
  await expect(select.locator('option')).toHaveCount(3);
  await select.selectOption('fixture-sam');
  await expect(page.getByText('Scopes nicht auslesbar.')).toBeVisible();
  await expect(
    page.getByText(/Actions starten: pro Repository ungeprüft\./),
  ).toBeVisible();
  const connect = page.getByRole('button', {
    name: 'gh-Konto mit RepoTray verbinden',
  });
  await expect(connect).toBeDisabled();
  expect((await calls()).some((c) => c.cmd === 'connect_local_auth')).toBe(
    false,
  );
  await page
    .getByRole('checkbox', {
      name: 'Ich möchte dieses gh-Konto in RepoTray verwenden',
    })
    .check();
  await connect.click();
  await expect(
    page.getByRole('heading', { name: 'Einstellungen', exact: true }),
  ).toBeVisible();
  expect(
    (await calls()).find((c) => c.cmd === 'connect_local_auth')?.args,
  ).toEqual({ login: 'fixture-sam', confirmImport: true });
  expect(
    JSON.stringify(await page.evaluate(() => ({ ...localStorage }))),
  ).not.toContain('fixture-sam');
  expect(
    (await calls()).some(
      (c) => c.cmd === 'connect_token' || c.cmd === 'dispatch_workflow',
    ),
  ).toBe(false);
});

test('unavailable sources stay unavailable and cancellation discards late process results', async ({
  page,
}) => {
  await configureMock<LocalMock>(page, { scanDelay: 400 });
  await page
    .getByText('Bestehende Anmeldung auf diesem PC verwenden', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }).click();
  await page
    .getByRole('button', { name: 'Prüfung abbrechen', exact: true })
    .click();
  // The absence check proves nothing until the late result was delivered.
  await expect
    .poll(() => readMockState<LocalMock, 'scansSettled'>(page, 'scansSettled'))
    .toBe(1);
  await expect(page.getByLabel('Lokales Konto · gh CLI')).toHaveCount(0);
  await configureMock<LocalMock>(page, { scanDelay: 0, empty: true });
  await page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }).click();
  await expect(
    page.getByText(
      'Keine nutzbare gh-Anmeldung gefunden. Melde dich mit „gh auth login“ an und prüfe erneut.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'gh-Konto mit RepoTray verbinden',
    }),
  ).toHaveCount(0);
  await page.getByText('Weitere lokale Quellen', { exact: true }).click();
  await expect(
    page.getByText('Git erkannt; keine API-Anmeldung belegt.'),
  ).toBeVisible();
});

test('discovery shows recognized rather than connected until consent, then retains active source feedback', async ({
  page,
}, testInfo) => {
  await expect(
    page.getByText('Noch kein gh-Konto in RepoTray verbunden'),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Bestehende Anmeldung auf diesem PC verwenden',
    })
    .click();
  await page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }).click();
  await page.getByLabel('Lokales Konto · gh CLI').selectOption('fixture-sam');
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'In gh erkannt · noch nicht mit RepoTray verbunden' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'gh-Konto mit RepoTray verbinden' }),
  ).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'Ich möchte dieses gh-Konto in RepoTray verwenden',
    })
    .check();
  await page
    .getByRole('button', { name: 'gh-Konto mit RepoTray verbinden' })
    .click();
  // The new account has no selected repositories yet: settings opens there.
  await expect(page.getByRole('tab', { name: 'Repositories' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByRole('status').filter({ hasText: 'fixture-sam ist verbunden' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Konten', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Verbundene Anmeldungen' }),
  ).toContainText('gh-Anmeldung übernommen · Aktiv für RepoTray');
  await page
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
  await expect(
    dialog.getByRole('region', { name: 'Verbundene Anmeldungen' }),
  ).toContainText('fixture-sam · gh CLI (Kopie)');
  await expect(
    dialog.getByText('1 gh-Konto in RepoTray verbunden'),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Bestehende Anmeldung auf diesem PC verwenden',
    })
    .click();
  await page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }).click();
  await page.getByLabel('Lokales Konto · gh CLI').selectOption('fixture-sam');
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'In RepoTray verbunden · aktives Konto' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'gh-Konto erneut übernehmen' }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 360, height: 840 });
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await dialog.screenshot({
    path: testInfo.outputPath('connected-gh-feedback-360.png'),
  });
});

test('every local result names the next step: failures, empty results and accounts RepoTray cannot import', async ({
  page,
}) => {
  const scan = page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' });
  await page
    .getByRole('button', {
      name: 'Bestehende Anmeldung auf diesem PC verwenden',
    })
    .click();
  await configureMock<LocalMock>(page, {
    scanError:
      'Mock: gh CLI konnte nicht geprüft werden. Prüfe im Terminal mit gh auth status, ob du angemeldet bist.',
  });
  await scan.click();
  await expect(page.getByRole('alert')).toContainText(
    'Prüfe im Terminal mit gh auth status',
  );
  await expect(scan).toBeEnabled();
  await configureMock<LocalMock>(page, { scanError: '', empty: true });
  await scan.click();
  await expect(
    page.getByText(
      'Keine nutzbare gh-Anmeldung gefunden. Melde dich mit „gh auth login“ an und prüfe erneut. Alternativ verbindest du dich unten mit einem Token.',
    ),
  ).toBeVisible();
  await configureMock<LocalMock>(page, {
    empty: false,
    importError:
      'Mock: Gewählte lokale Anmeldung ist nicht mehr verfügbar. Prüfe die lokalen Anmeldungen erneut.',
  });
  await page.getByRole('button', { name: 'Erneut prüfen' }).click();
  // The credential-manager entry stays listed, with what to do instead.
  await expect(
    page.getByText('Diese Anmeldungen kann RepoTray nicht übernehmen.'),
  ).toContainText('verbinde dich unten mit einem Token');
  await page.getByLabel('Lokales Konto · gh CLI').selectOption('fixture-sam');
  await page
    .getByRole('checkbox', {
      name: 'Ich möchte dieses gh-Konto in RepoTray verwenden',
    })
    .check();
  await page
    .getByRole('button', { name: 'gh-Konto mit RepoTray verbinden' })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Prüfe die lokalen Anmeldungen erneut.',
  );
  await expect(
    page.getByRole('dialog', { name: 'GitHub verbinden' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Erneut prüfen' }),
  ).toBeEnabled();
});
