import { expect, test, type Page } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { accountMenuButton, chooseAccount } from './support/demo';
import { installTauriMock, readCommands } from './support/tauriMock';

const menu = (page: Page) =>
  page.getByRole('menu', { name: 'Konto wechseln', exact: true });
const radio = (page: Page, name: string) =>
  page.getByRole('menuitemradio', { name, exact: true });
const action = (page: Page, name: string) =>
  page.getByRole('menuitem', { name, exact: true });
const status = (page: Page) =>
  page.getByRole('status', { name: 'Aktives Konto', exact: true });
/** The shown account names in the open menu, without the avatar letters. */
const accountNames = (page: Page) =>
  page.getByRole('menuitemradio').locator('.menu-item-label');

/**
 * Native panel (labelled IPC mock) with two entries of the same login, or
 * only the first `connected` of them.
 */
async function native(page: Page, saved: string | null = null, connected = 2) {
  if (saved)
    await page.addInitScript(
      (saved) =>
        localStorage.setItem(
          'repotray.activeAccount.v1',
          JSON.stringify(saved),
        ),
      saved,
    );
  await installTauriMock<
    { fixture: typeof fixture; connected: number },
    Record<string, never>
  >(
    page,
    ({ fixture, connected }) => {
      const accounts = [
        { id: 'github-42', login: 'fixture-user', label: 'GitHub · Token' },
        {
          id: 'github-device-42',
          login: 'fixture-user',
          label: 'GitHub · Browser',
        },
      ].slice(0, connected);
      const snapshot = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        accounts,
        repos: accounts.map((account, index) => ({
          ...fixture.repos[0],
          id: `${account.id}:repo`,
          accountId: account.id,
          name: index ? 'browser-repo' : 'token-repo',
          selected: true,
        })),
        workflows: accounts.map((account, index) => ({
          ...fixture.workflows[0],
          id: 100 + index,
          repoId: `${account.id}:repo`,
          name: index ? 'Browser Workflow' : 'Token Workflow',
        })),
        runs: [],
        pins: [],
      };
      return (cmd) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(snapshot);
        if (cmd === 'browser_auth_config') return { configured: true };
        if (cmd === 'discover_local_auth') return { accounts: [], notices: [] };
        return null;
      };
    },
    { arg: { fixture, connected }, state: {} },
  );
  await page.goto('/');
  await expect(accountMenuButton(page)).toBeEnabled();
}

test.describe('browser demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(accountMenuButton(page)).toBeEnabled();
  });

  test('the menu lists all accounts, the aggregate and the account actions', async ({
    page,
  }) => {
    const trigger = accountMenuButton(page);
    await expect(trigger).toHaveAccessibleName(
      'Konto: Alle Konten – Konto wechseln',
    );
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(menu(page)).toHaveCount(0);
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page)).toBeVisible();
    await expect(accountNames(page)).toHaveText([
      'Alle Konten',
      'demo-dev',
      'team-demo',
    ]);
    await expect(radio(page, 'Alle Konten')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(radio(page, 'demo-dev')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByRole('menuitem')).toHaveText([
      'Konto verbinden …',
      'Konten verwalten …',
    ]);
    await expect(radio(page, 'Alle Konten')).toBeFocused();
    // A press on the label or separator inside keeps the menu open.
    await menu(page).getByText('Konto', { exact: true }).click();
    await page.locator('.menu-separator').click({ force: true });
    await expect(menu(page)).toBeVisible();
    // A click outside closes the menu and leaves the page as it was.
    await page
      .getByRole('heading', { name: 'Repositories', exact: true })
      .click();
    await expect(menu(page)).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('arrow keys, Home and End move through the items; Escape returns focus', async ({
    page,
  }) => {
    const trigger = accountMenuButton(page);
    // Records whether the panel's own Escape handling saw the key as handled.
    await page.evaluate(() =>
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape')
          document.body.dataset.escapeHandled = String(event.defaultPrevented);
      }),
    );
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(radio(page, 'Alle Konten')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(radio(page, 'demo-dev')).toBeFocused();
    await page.keyboard.press('End');
    await expect(action(page, 'Konten verwalten …')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(radio(page, 'Alle Konten')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(action(page, 'Konten verwalten …')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(radio(page, 'Alle Konten')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // The menu consumed Escape (preventDefault), so the panel skips it.
    await expect(page.locator('body')).toHaveAttribute(
      'data-escape-handled',
      'true',
    );

    // ArrowUp opens on the last item; Tab closes and moves on from the button.
    await page.keyboard.press('ArrowUp');
    await expect(action(page, 'Konten verwalten …')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu(page)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Aktualisieren', exact: true }),
    ).toBeFocused();
  });

  test('switching the account with the keyboard changes the shown data', async ({
    page,
  }) => {
    await expect(
      page.getByText('demo-dev/launch-kit-demo', { exact: true }).first(),
    ).toBeVisible();
    const trigger = accountMenuButton(page);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(radio(page, 'Alle Konten')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(radio(page, 'team-demo')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAccessibleName(
      'Konto: team-demo – Konto wechseln',
    );
    await expect(status(page)).toContainText('team-demo');
    await expect(
      page.getByText('example-org/runner-tools-demo', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('demo-dev/launch-kit-demo', { exact: true }),
    ).toHaveCount(0);
    await trigger.click();
    await expect(radio(page, 'team-demo')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(radio(page, 'Alle Konten')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await page.keyboard.press('Escape');
    await chooseAccount(page, 'Alle Konten');
    await expect(
      page.getByText('demo-dev/launch-kit-demo', { exact: true }).first(),
    ).toBeVisible();
  });

  test('„Konto verbinden …“ opens the connection dialog and focus comes back', async ({
    page,
  }) => {
    await accountMenuButton(page).click();
    await action(page, 'Konto verbinden …').click();
    const dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
    await expect(dialog).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(accountMenuButton(page)).toBeFocused();
  });

  test('„Konten verwalten …“ opens settings on the accounts tab', async ({
    page,
  }) => {
    await accountMenuButton(page).click();
    await action(page, 'Konten verwalten …').click();
    const dialog = page.getByRole('dialog', {
      name: 'Einstellungen',
      exact: true,
    });
    await expect(
      dialog.getByRole('tab', { name: 'Konten', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(accountMenuButton(page)).toBeFocused();
  });

  test('the menu fits the 360px window and the brand keeps only its icon', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await expect(
      page.getByRole('heading', { name: 'RepoTray' }),
    ).toBeAttached();
    await accountMenuButton(page).click();
    const box = await menu(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    const bar = await page.locator('.app-bar').boundingBox();
    expect(bar!.height).toBeLessThanOrEqual(56);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  });
});

test.describe('native', () => {
  test('without a chosen account nothing is checked and no aggregate is offered', async ({
    page,
  }) => {
    await native(page);
    const trigger = accountMenuButton(page);
    await expect(trigger).toHaveAccessibleName(
      'Kein aktives Konto – Konto wechseln',
    );
    await expect(status(page)).toContainText('Kein aktives Konto');
    await trigger.click();
    await expect(accountNames(page)).toHaveText([
      'fixture-user · Token',
      'fixture-user · Browser',
    ]);
    await expect(radio(page, 'Alle Konten')).toHaveCount(0);
    for (const item of await page.getByRole('menuitemradio').all())
      await expect(item).toHaveAttribute('aria-checked', 'false');
    // Opening and moving through the menu never picks an account.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(status(page)).toContainText('Kein aktives Konto');
    expect(
      await page.evaluate(() =>
        localStorage.getItem('repotray.activeAccount.v1'),
      ),
    ).toBeNull();
  });

  test('without a connected account the menu offers only the account actions', async ({
    page,
  }) => {
    await native(page, null, 0);
    await accountMenuButton(page).click();
    await expect(page.getByRole('menuitemradio')).toHaveCount(0);
    await expect(menu(page).getByText('Konto', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem')).toHaveText([
      'Konto verbinden …',
      'Konten verwalten …',
    ]);
    await expect(action(page, 'Konto verbinden …')).toBeFocused();
  });

  test('choosing an entry activates exactly that source and is remembered', async ({
    page,
  }) => {
    await native(page, 'github-42');
    await expect(status(page)).toContainText('fixture-user · Token');
    await expect(
      page.getByText('demo-dev/token-repo', { exact: true }).first(),
    ).toBeVisible();
    await chooseAccount(page, 'fixture-user · Browser');
    await expect(status(page)).toContainText('fixture-user · Browser');
    await expect(
      page.getByText('demo-dev/browser-repo', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('demo-dev/token-repo', { exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('repotray.activeAccount.v1') ?? 'null'),
      ),
    ).toBe('github-device-42');
    await accountMenuButton(page).click();
    await expect(radio(page, 'fixture-user · Browser')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(radio(page, 'fixture-user · Token')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await page.keyboard.press('Escape');
    expect(await readCommands(page)).not.toContain('dispatch_workflow');
  });

  test('„Konto verbinden …“ opens the native connection dialog', async ({
    page,
  }) => {
    await native(page, 'github-42');
    await accountMenuButton(page).click();
    await action(page, 'Konto verbinden …').click();
    const dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('heading', { name: 'Anmeldeart wählen' }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(accountMenuButton(page)).toBeFocused();
  });
});
