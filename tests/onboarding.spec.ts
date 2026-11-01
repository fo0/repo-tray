import { expect, test, type Page } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { expectPage } from './support/demo';
import { installTauriMock, readCalls, readCommands } from './support/tauriMock';

/** Native first launch: no account; a token connects one with unselected repositories. */
test.beforeEach(async ({ page }) => {
  await installTauriMock<{ fixture: typeof fixture }, object>(
    page,
    ({ fixture }) => {
      const empty = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        accounts: [] as { id: string; login: string; label: string }[],
        repos: [] as typeof fixture.repos,
        workflows: [],
        runs: [],
        pins: [],
      };
      let snapshot = structuredClone(empty);
      return async (cmd, args) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(snapshot);
        if (cmd === 'connect_token') {
          if (args?.token !== 'synthetic-test-token')
            throw 'GitHub hat den Token nicht bestätigt.';
          snapshot = {
            ...snapshot,
            accounts: [
              { id: 'github-7', login: 'fixture-new', label: 'GitHub · Token' },
            ],
            repos: ['alpha', 'beta'].map((name) => ({
              ...fixture.repos[0]!,
              id: `github-7:${name}`,
              accountId: 'github-7',
              owner: 'fixture-new',
              name,
              selected: false,
            })),
          };
          return structuredClone(snapshot);
        }
        if (cmd === 'select_repos') {
          const ids = args?.repoIds as string[];
          snapshot = {
            ...snapshot,
            repos: snapshot.repos.map((repo) => ({
              ...repo,
              selected: ids.includes(repo.id),
            })),
          };
          return structuredClone(snapshot);
        }
        if (cmd === 'disconnect_account') {
          snapshot = structuredClone(empty);
          return structuredClone(snapshot);
        }
        return null;
      };
    },
    { arg: { fixture }, state: {} },
  );
  await page.goto('/');
});

const settings = (page: Page) =>
  page.getByRole('dialog', { name: 'Einstellungen', exact: true });
const connect = (page: Page) =>
  page.getByRole('dialog', { name: 'GitHub verbinden', exact: true });

async function connectToken(page: Page) {
  await connect(page).getByLabel('GitHub-Token').fill('synthetic-test-token');
  await connect(page)
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
}

test('the first-launch action opens the connect dialog directly and a first connect continues with repositories', async ({
  page,
}) => {
  const empty = page.locator('.empty-state').filter({
    has: page.getByRole('heading', { name: 'Verbinde dein GitHub-Konto' }),
  });
  await expect(empty).toContainText(
    'Verbinde dein GitHub-Konto mit einem Token oder übernimm deine gh-Anmeldung.',
  );
  await empty
    .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
    .click();
  await expect(connect(page)).toBeVisible();
  await expect(settings(page)).toHaveCount(0);
  await connectToken(page);
  await expect(settings(page)).toBeVisible();
  await expect(
    settings(page).getByRole('tab', { name: 'Repositories' }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(settings(page).getByRole('status')).toContainText(
    'fixture-new ist verbunden. Wähle jetzt die Repositories',
  );
  // The connection itself chose the account; no silent pick happened before.
  // The panel behind the open dialog is hidden from the accessibility tree.
  await expect(
    page.getByRole('status', {
      name: 'Aktives Konto',
      exact: true,
      includeHidden: true,
    }),
  ).toContainText('fixture-new · Token');
  await settings(page)
    .getByRole('checkbox', { name: /fixture-new\/alpha/ })
    .check();
  await settings(page)
    .getByRole('button', { name: 'Auswahl speichern' })
    .click();
  await expect(settings(page)).toHaveCount(0);
  expect((await readCalls(page, 'select_repos'))[0]?.args).toEqual({
    repoIds: ['github-7:alpha'],
  });
});

test('settings without an account show one empty state with one action', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  const dialog = settings(page);
  await expect(dialog.getByText(/Noch kein Konto/)).toHaveCount(1);
  await expect(dialog.getByText('0 Konten verbunden')).toHaveCount(0);
  await expect(
    dialog.getByLabel('Aktives Konto auswählen', { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Konto hinzufügen' }),
  ).toHaveCount(0);
  await dialog
    .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
    .click();
  await expect(connect(page)).toBeVisible();
  // No account was connected, so nothing was selected or remembered.
  expect(await readCommands(page)).not.toContain('connect_token');
  expect(
    await page.evaluate(() =>
      localStorage.getItem('repotray.activeAccount.v1'),
    ),
  ).toBeNull();
});

test('the repository empty state opens the repository tab, and removing the last account asks to connect', async ({
  page,
}) => {
  await page
    .locator('.empty-state')
    .filter({
      has: page.getByRole('heading', { name: 'Verbinde dein GitHub-Konto' }),
    })
    .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
    .click();
  await connectToken(page);
  await settings(page)
    .getByRole('button', { name: 'Dialog schließen' })
    .click();
  await page
    .getByRole('button', { name: 'Repositories auswählen', exact: true })
    .click();
  await expect(
    settings(page).getByRole('tab', { name: 'Repositories' }),
  ).toHaveAttribute('aria-selected', 'true');
  // Opened from the panel, not after a connect: no connect message.
  await expect(settings(page).getByRole('status')).toHaveCount(0);
  await settings(page)
    .getByRole('tab', { name: 'Konten', exact: true })
    .click();
  await settings(page)
    .getByRole('button', { name: 'fixture-new · Token trennen', exact: true })
    .click();
  await settings(page)
    .getByRole('button', { name: 'Trennen', exact: true })
    .click();
  await expect(
    settings(page).getByRole('heading', { name: 'Noch kein Konto verbunden' }),
  ).toBeVisible();
  await settings(page)
    .getByRole('button', { name: 'Schließen', exact: true })
    .click();
  await expect(
    page.getByText(
      'Das aktive Konto wurde entfernt. Verbinde ein GitHub-Konto, um fortzufahren.',
    ),
  ).toBeVisible();
});

test('every page without an account names the same next step: connect', async ({
  page,
}) => {
  // Without an account the overview shows only that step, no sections to
  // maximize; the shortcuts still reach every page.
  for (const [name, key] of [
    ['overview', null],
    ['repos', 'Control+1'],
    ['runs', 'Control+2'],
    ['favorites', 'Control+3'],
  ] as const) {
    if (key) await page.keyboard.press(key);
    await expectPage(page, name);
    const empty = page.locator('.empty-state');
    await expect(
      empty.getByRole('heading', { name: 'Verbinde dein GitHub-Konto' }),
    ).toBeVisible();
    await empty
      .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
      .click();
    await expect(connect(page)).toBeVisible();
    await expect(settings(page)).toHaveCount(0);
    await connect(page)
      .getByRole('button', { name: 'Abbrechen', exact: true })
      .click();
  }
});
