import { expect, test, type Page } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { openPage } from './support/demo';
import {
  type TauriMock,
  installTauriMock,
  readCalls,
} from './support/tauriMock';

type AccessMock = { stale: boolean };
let mock: TauriMock<AccessMock>;

// A browser-sign-in account offers the repository-access refresh in the
// picker; the mock revokes one repository and grants another on the first
// refresh.
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
      const repo = (name: string, selected: boolean) => ({
        ...fixture.repos[0],
        id: `${accountId}:${name}`,
        accountId,
        owner: 'fixture-user',
        name,
        selected,
      });
      const base = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        accounts: [
          { id: accountId, login: 'fixture-user', label: 'GitHub · Browser' },
        ],
        repos: [repo('kept-repo', true), repo('revoked-repo', true)],
        workflows: [],
        runs: [],
        pins: [],
      };
      let snapshot = structuredClone(base);
      return (cmd, args) => {
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
            repos: [repo('kept-repo', true), repo('granted-repo', false)],
          };
          return structuredClone(snapshot);
        }
        if (cmd === 'select_repos') {
          const ids = args?.repoIds as string[];
          snapshot = {
            ...snapshot,
            repos: snapshot.repos.map((item) => ({
              ...item,
              selected: ids.includes(item.id),
            })),
          };
          return structuredClone(snapshot);
        }
        return null;
      };
    },
    { arg: { fixture }, state: { stale: false } },
  );
  await page.goto('/');
  await openPage(page, 'picker');
});

/** A picker toggle; its name starts with the visible state (label in name). */
const toggle = (
  page: Page,
  name: string,
  state: 'Im Tray' | 'Hinzufügen' | null = null,
) =>
  page.getByRole('button', {
    name: state
      ? `${state}: fixture-user/${name}`
      : new RegExp(`^(Im Tray|Hinzufügen): fixture-user/${name}$`),
    exact: !!state,
  });

test('refreshing repository access shows granted repositories and drops revoked selections', async ({
  page,
}) => {
  await expect(toggle(page, 'revoked-repo', 'Im Tray')).toBeVisible();
  await expect(
    page.getByText('2 von höchstens 50 Repositories im Tray'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Repository-Liste aktualisieren' })
    .click();
  await expect(toggle(page, 'granted-repo', 'Hinzufügen')).toBeVisible();
  await expect(toggle(page, 'revoked-repo')).toHaveCount(0);
  await expect(toggle(page, 'kept-repo', 'Im Tray')).toBeVisible();
  await expect(
    page.getByText('1 von höchstens 50 Repositories im Tray'),
  ).toBeVisible();
  await expect(
    page.getByText('Mock: Repository-Zugriff nicht abrufbar.'),
  ).toHaveCount(0);
  // A granted repository is one click away; it applies at once.
  await toggle(page, 'granted-repo', 'Hinzufügen').click();
  await expect(toggle(page, 'granted-repo', 'Im Tray')).toBeVisible();
  expect((await readCalls(page, 'select_repos'))[0]?.args).toEqual({
    repoIds: ['github-device-42:kept-repo', 'github-device-42:granted-repo'],
  });
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
  await expect(toggle(page, 'revoked-repo', 'Im Tray')).toBeVisible();
  await expect(toggle(page, 'granted-repo')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Repository-Liste aktualisieren' }),
  ).toBeEnabled();
});

test('the picker offers changing the repository access on GitHub', async ({
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
