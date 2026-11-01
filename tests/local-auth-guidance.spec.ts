import { expect, test } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { installTauriMock, type TauriMock } from './support/tauriMock';

type GuidanceMock = { scanError: string; importError: string; empty: boolean };
let mock: TauriMock<GuidanceMock>;

/** Native connect dialog without accounts; discovery and import fail on demand. */
test.beforeEach(async ({ page }) => {
  mock = await installTauriMock<{ fixture: typeof fixture }, GuidanceMock>(
    page,
    ({ fixture }, state) => {
      const accounts = [
        {
          source: 'gh',
          host: 'github.com',
          login: 'fixture-sam',
          usable: true,
          active: true,
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
          detail: 'Credential-Manager-Konto; API-Übernahme nicht unterstützt.',
          actionsRead: 'Keine Actions-API-Rechte belegt.',
          actionsWrite: 'Nicht nachgewiesen.',
        },
      ];
      return async (cmd) => {
        if (cmd === 'snapshot')
          return {
            ...fixture,
            mode: 'live',
            accounts: [],
            repos: [],
            workflows: [],
            runs: [],
            pins: [],
          };
        if (cmd === 'discover_local_auth') {
          if (state.scanError) throw state.scanError;
          return { accounts: state.empty ? [] : accounts, notices: [] };
        }
        if (cmd === 'connect_local_auth') throw state.importError;
        return null;
      };
    },
    {
      arg: { fixture },
      state: { scanError: '', importError: '', empty: false },
    },
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Bestehende Anmeldung auf diesem PC verwenden',
    })
    .click();
});

test('every local result names the next step: failures, empty results and accounts RepoTray cannot import', async ({
  page,
}) => {
  const scan = page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' });
  await mock.configure({
    scanError:
      'Mock: gh CLI konnte nicht geprüft werden. Prüfe im Terminal mit gh auth status, ob du angemeldet bist.',
  });
  await scan.click();
  await expect(page.getByRole('alert')).toContainText(
    'Prüfe im Terminal mit gh auth status',
  );
  await expect(scan).toBeEnabled();
  await mock.configure({ scanError: '', empty: true });
  await scan.click();
  await expect(
    page.getByText(
      'Keine nutzbare gh-Anmeldung gefunden. Melde dich mit „gh auth login“ an und prüfe erneut. Alternativ verbindest du dich unten mit einem Token.',
    ),
  ).toBeVisible();
  await mock.configure({
    empty: false,
    importError:
      'Mock: Gewählte lokale Anmeldung ist nicht mehr verfügbar. Prüfe die lokalen Anmeldungen erneut.',
  });
  await page.getByRole('button', { name: 'Erneut prüfen' }).click();
  // The credential-manager entry stays listed, with what to do instead.
  await expect(
    page.getByText('Diese Anmeldungen kann RepoTray nicht übernehmen.'),
  ).toContainText('verbinde dich unten mit einem Token');
  await expect(page.getByLabel('Lokales Konto · gh CLI')).toHaveValue(
    'fixture-sam',
  );
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
