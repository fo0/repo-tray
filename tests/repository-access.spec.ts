import { expect, test, type Page } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { openPage } from './support/demo';
import {
  type TauriMock,
  installTauriMock,
  readCalls,
  readCommands,
} from './support/tauriMock';

type AccessMock = { stale: boolean };
let mock: TauriMock<AccessMock>;

// A browser-sign-in account offers the repository-access refresh on the
// Repositories page; the mock revokes one repository and grants another on the
// first refresh, which the service selects automatically.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'repotray.activeAccount.v1',
      JSON.stringify('github-device-42'),
    ),
  );
  mock = await installTauriMock<{ fixture: typeof fixture }, AccessMock>(
    page,
    ({ fixture }, state) => {
      const accountId = 'github-device-42';
      const repo = (name: string) => ({
        ...fixture.repos[0],
        id: `${accountId}:${name}`,
        accountId,
        owner: 'fixture-user',
        name,
        selected: true,
      });
      const base = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        accounts: [
          { id: accountId, login: 'fixture-user', label: 'GitHub · Browser' },
        ],
        repos: [repo('kept-repo'), repo('revoked-repo')],
        workflows: [],
        runs: [],
        pins: [],
      };
      let snapshot = structuredClone(base);
      return (cmd) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(snapshot);
        if (cmd === 'refresh_repositories') {
          if (state.stale)
            return {
              ...structuredClone(snapshot),
              stale: true,
              message: 'Mock: Repository-Zugriff nicht abrufbar.',
            };
          snapshot = {
            ...snapshot,
            repos: [repo('kept-repo'), repo('granted-repo')],
          };
          return structuredClone(snapshot);
        }
        return null;
      };
    },
    { arg: { fixture }, state: { stale: false } },
  );
  await page.goto('/');
  await openPage(page, 'repos');
});

/** A repository row of the Repositories page. */
const row = (page: Page, name: string) =>
  page.getByRole('region', { name: `fixture-user/${name}`, exact: true });

test('refreshing repository access shows granted repositories and drops revoked ones', async ({
  page,
}) => {
  await expect(row(page, 'revoked-repo')).toBeVisible();
  await page
    .getByRole('button', { name: 'Repository-Liste aktualisieren' })
    .click();
  // The granted repository shows at once: nothing to add by hand.
  await expect(row(page, 'granted-repo')).toBeVisible();
  await expect(row(page, 'revoked-repo')).toHaveCount(0);
  await expect(row(page, 'kept-repo')).toBeVisible();
  await expect(
    page.getByText('Mock: Repository-Zugriff nicht abrufbar.'),
  ).toHaveCount(0);
  expect(await readCommands(page)).not.toContain('select_repos');
});

test('a stale repository-access refresh reports its error and keeps the list', async ({
  page,
}) => {
  await mock.configure({ stale: true });
  await page
    .getByRole('button', { name: 'Repository-Liste aktualisieren' })
    .click();
  await expect(
    page
      .locator('.alert.warning')
      .filter({ hasText: 'Mock: Repository-Zugriff nicht abrufbar.' }),
  ).toBeVisible();
  await expect(row(page, 'revoked-repo')).toBeVisible();
  await expect(row(page, 'granted-repo')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Repository-Liste aktualisieren' }),
  ).toBeEnabled();
});

test('the Repositories page offers changing the repository access on GitHub', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Repository-Freigabe auf GitHub ändern' })
    .click();
  await expect
    .poll(
      async () => (await readCalls(page, 'open_browser_installation')).length,
    )
    .toBe(1);
});
