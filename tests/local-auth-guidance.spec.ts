import { expect, test } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { checkLocal, connectDialog } from './support/connect';
import { installTauriMock, type TauriMock } from './support/tauriMock';

type GuidanceMock = {
  scanError: string;
  importError: string;
  empty: boolean;
  missing: boolean;
};
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
          // The service names a missing gh in a fixed notice.
          if (state.missing)
            return {
              accounts: [],
              notices: [
                'gh CLI nicht gefunden. Installiere GitHub CLI (gh), starte RepoTray danach neu und prüfe im Terminal gh auth status. Git allein reicht nicht.',
              ],
            };
          return { accounts: state.empty ? [] : accounts, notices: [] };
        }
        if (cmd === 'connect_local_auth') throw state.importError;
        return null;
      };
    },
    {
      arg: { fixture },
      state: { scanError: '', importError: '', empty: false, missing: false },
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

test('every local result is one short line with one next action: failure, gh missing, nothing found, import error', async ({
  page,
}) => {
  const dialog = connectDialog(page);
  const body = dialog.locator('.modal-body');
  const rescan = dialog.getByRole('button', {
    name: 'Erneut prüfen',
    exact: true,
  });
  await mock.configure({
    scanError:
      'Mock: gh CLI konnte nicht geprüft werden. Prüfe im Terminal mit gh auth status, ob du angemeldet bist.',
  });
  await checkLocal(page);
  await expect(dialog.getByRole('alert')).toContainText(
    'Prüfe im Terminal mit gh auth status',
  );
  // The footer's one primary action is the retry; „Zurück“ is the other way.
  await expect(dialog.locator('.modal-actions').getByRole('button')).toHaveText(
    ['Zurück', 'Erneut prüfen'],
  );
  await mock.configure({ scanError: '', missing: true });
  await rescan.click();
  await expect(body).toContainText(
    'GitHub CLI (gh) nicht gefunden. Nach der Installation RepoTray neu starten.',
  );
  await expect(body).not.toContainText('Git allein reicht nicht');
  await mock.configure({ missing: false, empty: true });
  await rescan.click();
  await expect(body).toContainText(
    'Keine gh-Anmeldung gefunden. Im Terminal mit „gh auth login“ anmelden.',
  );
  await mock.configure({
    empty: false,
    importError:
      'Mock: Gewählte lokale Anmeldung ist nicht mehr verfügbar. Prüfe die lokalen Anmeldungen erneut.',
  });
  await rescan.click();
  // A single importable account is preselected; the GCM entry stays listed, off.
  const list = dialog.getByRole('radiogroup', { name: 'Gefundene Konten' });
  await expect(list.getByRole('radio', { name: /fixture-sam/ })).toBeChecked();
  await expect(list.getByRole('radio', { name: /fixture-gcm/ })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Prüfe die lokalen Anmeldungen erneut.',
  );
  await expect(dialog).toBeVisible();
  // „Übernehmen“ stays the primary action; the check can be repeated in place.
  await expect(
    dialog.getByRole('button', { name: 'Übernehmen', exact: true }),
  ).toBeEnabled();
  await expect(rescan).toBeEnabled();
});
