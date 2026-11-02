import { expect, test, type Page } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { connectToken as connectWith } from './support/connect';
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

const connectToken = (page: Page) => connectWith(page, 'synthetic-test-token');

test('the first-launch action opens the connect dialog directly and a first connect continues in the repository picker', async ({
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
  // The picker replaces the dialog, not the settings; its search has focus.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectPage(page, 'picker');
  await expect(page.getByLabel('Repositories filtern')).toBeFocused();
  await expect(
    page.getByRole('status').filter({ hasText: 'fixture-new ist verbunden' }),
  ).toContainText(
    'fixture-new ist verbunden. Wähle jetzt die Repositories, die in deinem Tray erscheinen sollen.',
  );
  // The connection itself chose the account; no silent pick happened before.
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('fixture-new · Token');
  // Nothing was selected silently: every repository waits for a choice.
  const toggle = (state: string, name: string) =>
    page.getByRole('button', {
      name: `${state}: fixture-new/${name}`,
      exact: true,
    });
  await expect(toggle('Hinzufügen', 'alpha')).toBeVisible();
  await expect(toggle('Hinzufügen', 'beta')).toBeVisible();
  expect(await readCalls(page, 'select_repos')).toEqual([]);
  await toggle('Hinzufügen', 'alpha').click();
  await expect(toggle('Im Tray', 'alpha')).toBeVisible();
  expect((await readCalls(page, 'select_repos'))[0]?.args).toEqual({
    repoIds: ['github-7:alpha'],
  });
  // Back on the overview, the repository is there; the banner is gone.
  await page.getByRole('button', { name: 'Zurück zur Übersicht' }).click();
  await expectPage(page, 'overview');
  await expect(
    page.getByRole('region', { name: 'fixture-new/alpha', exact: true }),
  ).toBeVisible();
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
    dialog.getByRole('radiogroup', { name: 'Aktives Konto' }),
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

test('the repository empty state opens the picker, and removing the last account asks to connect', async ({
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
  await expectPage(page, 'picker');
  await page.getByRole('button', { name: 'Zurück zur Übersicht' }).click();
  const next = page.getByRole('button', {
    name: 'Repositories auswählen',
    exact: true,
  });
  await expect(page.locator('.empty-state')).toContainText(
    'Noch keine Repositories ausgewählt',
  );
  await next.click();
  await expectPage(page, 'picker');
  // Opened from the panel, not after a connect: no connect message.
  await expect(
    page.getByRole('status').filter({ hasText: 'ist verbunden' }),
  ).toHaveCount(0);
  // Back where it came from, with focus on the same action.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expectPage(page, 'overview');
  await expect(next).toBeFocused();
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
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
    .getByRole('button', { name: 'Abbrechen', exact: true })
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
