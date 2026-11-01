import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import {
  configureMock,
  installTauriMock,
  readCalls,
} from './support/tauriMock';

type AccessMock = { stale: boolean };

// A browser-sign-in account offers the repository-access refresh; the mock
// revokes one repository and grants another on the first refresh.
test.beforeEach(async ({ page }) => {
  await installTauriMock<{ fixture: typeof fixture }, AccessMock>(
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
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Repositories', exact: true }).click();
});

const repoBox = (page: Page, name: string) =>
  page.getByRole('checkbox', { name: new RegExp(`fixture-user/${name}\\b`) });

test('refreshing repository access shows granted repositories and drops revoked selections', async ({
  page,
}) => {
  await expect(repoBox(page, 'revoked-repo')).toBeChecked();
  await expect(page.getByText('2 Repositories ausgewählt')).toBeVisible();
  await page
    .getByRole('button', { name: 'Repository-Liste aktualisieren' })
    .click();
  await expect(repoBox(page, 'granted-repo')).not.toBeChecked();
  await expect(repoBox(page, 'revoked-repo')).toHaveCount(0);
  await expect(repoBox(page, 'kept-repo')).toBeChecked();
  await expect(page.getByText('1 Repository ausgewählt')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Auswahl speichern' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await readCalls(page, 'select_repos'))[0].args).toEqual({
    repoIds: ['github-device-42:kept-repo'],
  });
});

test('a stale repository-access refresh reports its error and keeps the list', async ({
  page,
}) => {
  await configureMock<AccessMock>(page, { stale: true });
  await page
    .getByRole('button', { name: 'Repository-Liste aktualisieren' })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Mock: Repository-Zugriff nicht abrufbar.',
  );
  await expect(repoBox(page, 'revoked-repo')).toBeChecked();
  await expect(repoBox(page, 'granted-repo')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Repository-Liste aktualisieren' }),
  ).toBeEnabled();
});
