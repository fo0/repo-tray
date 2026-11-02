import { expect, test, type Page } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { connectToken as connectWith } from './support/connect';
import { SECTION_TITLES, expectPage } from './support/demo';
import {
  installTauriMock,
  readCommands,
  type TauriMock,
} from './support/tauriMock';

type OnboardingMock = { repos: string[] };
let mock: TauriMock<OnboardingMock>;

/**
 * Native first launch: no account; a token connects one whose repositories
 * the service already selected automatically (`repos`, by name).
 */
test.beforeEach(async ({ page }) => {
  mock = await installTauriMock<{ fixture: typeof fixture }, OnboardingMock>(
    page,
    ({ fixture }, state) => {
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
            repos: state.repos.map((name) => ({
              ...fixture.repos[0]!,
              id: `github-7:${name}`,
              accountId: 'github-7',
              owner: 'fixture-new',
              name,
              selected: true,
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
    { arg: { fixture }, state: { repos: ['alpha', 'beta'] } },
  );
  await page.goto('/');
});

const settings = (page: Page) =>
  page.getByRole('dialog', { name: 'Einstellungen', exact: true });
const connect = (page: Page) =>
  page.getByRole('dialog', { name: 'GitHub verbinden', exact: true });

const connectToken = (page: Page) => connectWith(page, 'synthetic-test-token');

test('the first-launch action opens the connect dialog directly and a first connect lands on the overview', async ({
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
  // The overview replaces the dialog, not the settings; its search has focus.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectPage(page, 'overview');
  await expect(page.getByLabel('Übersicht durchsuchen')).toBeFocused();
  // One short notice, nothing more to read.
  const notices = page.locator('.notice-banner');
  await expect(notices).toHaveCount(1);
  await expect(notices).toContainText('Konto fixture-new verbunden.');
  // The connection itself chose the account; no silent pick happened before.
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('fixture-new · Token');
  // The service picked the repositories; nothing is left to choose.
  for (const name of ['alpha', 'beta'])
    await expect(
      page.getByRole('region', { name: `fixture-new/${name}`, exact: true }),
    ).toBeVisible();
  await expect(page.getByRole('button', { name: /Hinzufügen/ })).toHaveCount(0);
  expect(await readCommands(page)).not.toContain('select_repos');
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

test('an account without repositories says so in one line, and removing the last account asks to connect', async ({
  page,
}) => {
  await mock.configure({ repos: [] });
  await page
    .locator('.empty-state')
    .filter({
      has: page.getByRole('heading', { name: 'Verbinde dein GitHub-Konto' }),
    })
    .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
    .click();
  await connectToken(page);
  await expectPage(page, 'overview');
  const repos = page.getByRole('region', {
    name: SECTION_TITLES.repos,
    exact: true,
  });
  await expect(repos.locator('.section-empty')).toHaveText(
    'Keine Repositories gefunden.',
  );
  await expect(page.locator('.empty-state')).toHaveCount(0);
  await expect(
    repos.getByRole('button', { name: /Hinzufügen|auswählen/ }),
  ).toHaveCount(0);
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
