import { expect, test, type Page } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { installTauriMock, readCommands } from './support/tauriMock';

/**
 * Simple settings are staged: „Speichern“ applies them and closes the dialog,
 * „Abbrechen“, Escape and the close button discard them.
 */
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Einstellungen', exact: true });
const save = (page: Page) =>
  dialog(page).getByRole('button', { name: 'Speichern', exact: true });
async function open(page: Page, tab?: 'App') {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  if (tab) await dialog(page).getByRole('tab', { name: tab }).click();
}
const theme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const storedTheme = (page: Page) =>
  page.evaluate(() => localStorage.getItem('repotray.theme.v1'));

test('a theme previews while staged, every way out but „Speichern“ restores it, „Speichern“ keeps it', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const closers: [string, (page: Page) => Promise<void>][] = [
    [
      'Abbrechen',
      (page) =>
        dialog(page)
          .getByRole('button', { name: 'Abbrechen', exact: true })
          .click(),
    ],
    ['Escape', (page) => page.keyboard.press('Escape')],
    [
      'close button',
      (page) =>
        dialog(page).getByRole('button', { name: 'Dialog schließen' }).click(),
    ],
  ];
  for (const [, close] of closers) {
    await open(page, 'App');
    await expect(save(page)).toBeDisabled();
    await dialog(page)
      .getByRole('radio', { name: 'Hell', exact: true })
      .check();
    // The preview shows at once, but nothing is stored yet.
    expect(await theme(page)).toBe('light');
    expect(await storedTheme(page)).toBeNull();
    await expect(save(page)).toBeEnabled();
    await close(page);
    await expect(dialog(page)).toHaveCount(0);
    expect(await theme(page)).toBeNull();
    expect(await storedTheme(page)).toBeNull();
  }
  await open(page, 'App');
  await expect(
    dialog(page).getByRole('radio', { name: 'System', exact: true }),
  ).toBeChecked();
  await dialog(page).getByRole('radio', { name: 'Hell', exact: true }).check();
  await save(page).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(await theme(page)).toBe('light');
  expect(await storedTheme(page)).toBe('"light"');
  await open(page, 'App');
  await expect(
    dialog(page).getByRole('radio', { name: 'Hell', exact: true }),
  ).toBeChecked();
  await expect(save(page)).toBeDisabled();
  // Choosing the saved theme again stages nothing.
  await dialog(page)
    .getByRole('radio', { name: 'Dunkel', exact: true })
    .check();
  await dialog(page).getByRole('radio', { name: 'Hell', exact: true }).check();
  await expect(save(page)).toBeDisabled();
});

test('the demo scenario applies only with „Speichern“', async ({ page }) => {
  await page.goto('/');
  const connection = page.getByRole('status', { name: 'Verbindungsstatus' });
  await open(page);
  await dialog(page).getByLabel('Demo-Szenario').selectOption('offline');
  await dialog(page)
    .getByRole('button', { name: 'Abbrechen', exact: true })
    .click();
  await expect(connection).not.toContainText('Offline');
  await open(page);
  await expect(dialog(page).getByLabel('Demo-Szenario')).toHaveValue('normal');
  await dialog(page).getByLabel('Demo-Szenario').selectOption('offline');
  await save(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(connection).toContainText('Offline');
});

test('the active account changes only with „Speichern“, together with the other staged settings', async ({
  page,
}) => {
  await installTauriMock<{ fixture: typeof fixture }, object>(
    page,
    ({ fixture }) => {
      const accounts = [
        { id: 'github-42', login: 'fixture-user', label: 'GitHub · Token' },
        {
          id: 'github-device-42',
          login: 'fixture-user',
          label: 'GitHub · Browser',
        },
      ];
      const snapshot = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        accounts,
        repos: accounts.map((account) => ({
          ...fixture.repos[0],
          id: `${account.id}:repo`,
          accountId: account.id,
          selected: true,
        })),
        workflows: [],
        runs: [],
        pins: [],
      };
      return (cmd) =>
        cmd === 'snapshot' || cmd === 'refresh_snapshot'
          ? structuredClone(snapshot)
          : cmd === 'autostart_status'
            ? { status: 'disabled', registered: false }
            : null;
    },
    { arg: { fixture }, state: {} },
  );
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('repotray.activeAccount.v1', '"github-42"');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const status = page.getByRole('status', {
    name: 'Aktives Konto',
    exact: true,
  });
  const stored = () =>
    page.evaluate(() => localStorage.getItem('repotray.activeAccount.v1'));
  await expect(status).toContainText('fixture-user · Token');
  const browser = () =>
    dialog(page).getByRole('radio', {
      name: 'fixture-user · Browser',
      exact: true,
    });
  // Staged on two tabs, then dropped: nothing changed.
  await open(page);
  await browser().check();
  await dialog(page).getByRole('tab', { name: 'App' }).click();
  await dialog(page).getByRole('radio', { name: 'Hell', exact: true }).check();
  await dialog(page).getByRole('tab', { name: 'Konten' }).click();
  await expect(browser()).toBeChecked();
  await dialog(page)
    .getByRole('button', { name: 'Abbrechen', exact: true })
    .click();
  await expect(status).toContainText('fixture-user · Token');
  expect(await stored()).toBe('"github-42"');
  expect(await theme(page)).toBeNull();
  // Staged again and saved: both apply, the dialog closes.
  await open(page);
  await expect(
    dialog(page).getByRole('radio', {
      name: 'fixture-user · Token',
      exact: true,
    }),
  ).toBeChecked();
  await browser().check();
  await dialog(page).getByRole('tab', { name: 'App' }).click();
  await dialog(page).getByRole('radio', { name: 'Hell', exact: true }).check();
  await save(page).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(status).toContainText('fixture-user · Browser');
  expect(await stored()).toBe('"github-device-42"');
  expect(await theme(page)).toBe('light');
  expect(await readCommands(page)).not.toContain('set_autostart');
});
