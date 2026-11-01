import { expect, test, type Page } from './support/test';
import { openPage } from './support/demo';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { installTauriMock, readCalls, readCommands } from './support/tauriMock';
const key = 'repotray.activeAccount.v1';
type AccountMock = { updateDelay: number };
async function setup(page: Page, saved: string | null = null) {
  const mock = await installTauriMock<
    { fixture: typeof fixture; saved: string | null; key: string },
    AccountMock
  >(
    page,
    ({ fixture, saved, key }, state) => {
      if (!sessionStorage.getItem('fixture-bootstrapped')) {
        if (saved) localStorage.setItem(key, JSON.stringify(saved));
        sessionStorage.setItem('fixture-bootstrapped', 'true');
      }
      const source = [
        { id: 'github-42', login: 'fixture-user', label: 'GitHub · Token' },
        {
          id: 'github-device-42',
          login: 'fixture-user',
          label: 'GitHub · Browser',
        },
      ];
      let snapshot = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        accounts: source.filter(
          (account) => account.id !== localStorage.getItem('fixture-removed'),
        ),
        repos: source.map((account, index) => ({
          ...fixture.repos[0],
          id: `${account.id}:repo`,
          accountId: account.id,
          name: index ? 'browser-repo' : 'token-repo',
          selected: true,
        })),
        workflows: source.map((account, index) => ({
          ...fixture.workflows[0],
          id: 100 + index,
          repoId: `${account.id}:repo`,
          name: index ? 'Browser Workflow' : 'Token Workflow',
        })),
        runs: [],
        pins: source.map((account, index) => ({
          ...fixture.pins[0],
          id: `${account.id}:pin`,
          accountId: account.id,
          repoId: `${account.id}:repo`,
          workflowId: 100 + index,
          label: index ? 'Browser Vorlage' : 'Token Vorlage',
          quickStart: false,
        })),
      };
      snapshot.repos = snapshot.repos.filter((repo) =>
        snapshot.accounts.some((account) => account.id === repo.accountId),
      );
      return async (cmd, args) => {
        if (
          ['snapshot', 'refresh_snapshot', 'refresh_repositories'].includes(cmd)
        )
          return structuredClone(snapshot);
        if (cmd === 'browser_auth_config') return { configured: true };
        if (cmd === 'discover_local_auth') return { accounts: [], notices: [] };
        if (cmd === 'check_update') {
          await new Promise((resolve) =>
            setTimeout(resolve, state.updateDelay),
          );
          return {
            version: '0.2.0',
            notes: `Öffentliches Update`,
            downloadUrl:
              'https://github.com/fo0/repo-tray/releases/download/v0.2.0/RepoTray_0.2.0_x64-setup.exe',
          };
        }
        if (cmd === 'disconnect_account') {
          const id = String(args?.accountId);
          snapshot = {
            ...snapshot,
            accounts: snapshot.accounts.filter((account) => account.id !== id),
            repos: snapshot.repos.filter((repo) => repo.accountId !== id),
            pins: snapshot.pins.filter((pin) => pin.accountId !== id),
          };
          return structuredClone(snapshot);
        }
        return null;
      };
    },
    { arg: { fixture, saved, key }, state: { updateDelay: 0 } },
  );
  await page.goto('/');
  return mock;
}
const workspace = (page: Page) =>
  page.getByRole('dialog', { name: 'Einstellungen', exact: true });
/** Opens settings from the panel; waits for any earlier dialog to be gone. */
async function openSettings(page: Page) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await expect(workspace(page)).toBeVisible();
}
async function closeSettings(page: Page) {
  await workspace(page)
    .getByRole('button', { name: 'Schließen', exact: true })
    .click();
  await expect(workspace(page)).toHaveCount(0);
}
/** Picks the active account inside settings that are already open. */
async function pickAccount(page: Page, id: string) {
  await expect(workspace(page)).toBeVisible();
  await page.getByRole('tab', { name: 'Konten', exact: true }).click();
  await page
    .getByLabel('Aktives Konto auswählen', { exact: true })
    .selectOption(id);
}
/** Opens settings, picks the active account and closes settings again. */
async function chooseAccount(page: Page, id: string) {
  await openSettings(page);
  await pickAccount(page, id);
  await closeSettings(page);
}
/** Disconnects a connection from its settings card, confirming in place. */
async function disconnect(page: Page, title: string) {
  await page
    .getByRole('button', { name: `${title} trennen`, exact: true })
    .click();
  await page
    .getByRole('group', { name: `${title} trennen?`, exact: true })
    .getByRole('button', { name: 'Trennen', exact: true })
    .click();
}
function updateCalls(page: Page) {
  return readCalls(page, 'check_update');
}

test('native startup requires an account choice for workflows while updates need no account', async ({
  page,
}) => {
  await setup(page);
  await expect(
    page.getByLabel('Aktives Konto auswählen', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('Kein aktives Konto');
  expect(await updateCalls(page)).toHaveLength(1);
  // „Konto wählen“ opens the account menu in place: nothing is checked yet.
  await page.getByRole('button', { name: 'Konto wählen', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Konto wechseln' });
  await expect(
    menu.getByRole('menuitemradio').locator('.menu-item-label'),
  ).toHaveText(['fixture-user · Token', 'fixture-user · Browser']);
  await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
  await expect(menu.getByRole('menuitemradio', { checked: true })).toHaveCount(
    0,
  );
  await menu
    .getByRole('menuitem', { name: 'Konten verwalten …', exact: true })
    .click();
  const picker = page.getByLabel('Aktives Konto auswählen', { exact: true });
  await expect(
    page.getByRole('heading', { name: 'Aktives Konto', exact: true }),
  ).toBeVisible();
  await expect(picker).toHaveValue('');
  await expect(picker.locator('option')).toHaveText([
    'Aktives Konto auswählen',
    'fixture-user · Token',
    'fixture-user · Browser',
  ]);
  await page.getByRole('tab', { name: 'Updates' }).click();
  await expect(
    page.getByRole('button', { name: 'Auf Updates prüfen' }),
  ).toBeEnabled();
  expect((await updateCalls(page))[0]?.args).toEqual({});
});

test('source-specific settings selection survives restart and pins remain tied to their original credential', async ({
  page,
}) => {
  await setup(page);
  await chooseAccount(page, 'github-device-42');
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('fixture-user · Browser');
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? 'null'),
      key,
    ),
  ).toBe('github-device-42');
  await page.reload();
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('fixture-user · Browser');
  await openSettings(page);
  await expect(
    page.getByLabel('Aktives Konto auswählen', { exact: true }),
  ).toHaveValue('github-device-42');
  await closeSettings(page);
  await openPage(page, 'favorites');
  await expect(
    page.getByRole('heading', { name: 'Browser Vorlage', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Token Vorlage', exact: true }),
  ).toHaveCount(0);
  await chooseAccount(page, 'github-42');
  await expect(
    page.getByRole('heading', { name: 'Token Vorlage', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Browser Vorlage', exact: true }),
  ).toHaveCount(0);
  expect(await readCommands(page)).not.toContain('dispatch_workflow');
});

test('a missing remembered account offers a settings path without falling back to the same login through another source', async ({
  page,
}) => {
  await setup(page, 'github-device-42');
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('fixture-user · Browser');
  await page.evaluate(() =>
    localStorage.setItem('fixture-removed', 'github-device-42'),
  );
  await page.reload();
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('Kein aktives Konto');
  await expect(
    page.getByText(
      'Das gespeicherte Konto ist nicht mehr verbunden. Wähle ein aktives Konto neu aus.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Konto wählen', exact: true }).click();
  await expect(
    page
      .getByRole('menu', { name: 'Konto wechseln' })
      .getByRole('menuitemradio')
      .locator('.menu-item-label'),
  ).toHaveText(['fixture-user · Token']);
  // Escape closes the menu without a choice; nothing was remembered.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('Kein aktives Konto');
  expect(await updateCalls(page)).toHaveLength(1);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();
});

test('disconnecting another source preserves the active account; removing the active source requires a new settings choice', async ({
  page,
}) => {
  await setup(page, 'github-device-42');
  await openSettings(page);
  await disconnect(page, 'fixture-user · Token');
  await expect(
    page.getByLabel('Aktives Konto auswählen', { exact: true }),
  ).toHaveValue('github-device-42');
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? 'null'),
      key,
    ),
  ).toBe('github-device-42');
  await closeSettings(page);
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('fixture-user · Browser');
  await openSettings(page);
  await disconnect(page, 'fixture-user · Browser');
  // No account is left to fall back to; settings ask for a new connection.
  await expect(
    page.getByRole('heading', { name: 'Noch kein Konto verbunden' }),
  ).toBeVisible();
  await closeSettings(page);
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('Kein aktives Konto');
  await expect(page.getByText(/Das aktive Konto wurde entfernt/)).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();
});

test('public update results survive account switches without using any account token', async ({
  page,
}) => {
  await setup(page, 'github-42');
  await openSettings(page);
  await page.getByRole('tab', { name: 'Updates' }).click();
  await expect(
    page.getByText('Öffentliches Update', { exact: true }),
  ).toBeVisible();
  await pickAccount(page, 'github-device-42');
  await page.getByRole('tab', { name: 'Updates' }).click();
  await expect(
    page.getByText('Öffentliches Update', { exact: true }),
  ).toBeVisible();
  expect(await updateCalls(page)).toHaveLength(1);
  expect((await updateCalls(page))[0]?.args).toEqual({});
});

test('an in-flight public update check remains valid after switching the workflow account', async ({
  page,
}) => {
  const mock = await setup(page, 'github-42');
  await openSettings(page);
  await page.getByRole('tab', { name: 'Updates' }).click();
  await expect(
    page.getByText('Öffentliches Update', { exact: true }),
  ).toBeVisible();
  await mock.configure({ updateDelay: 600 });
  await page.getByRole('button', { name: 'Auf Updates prüfen' }).click();
  await pickAccount(page, 'github-device-42');
  await page.getByRole('tab', { name: 'Updates' }).click();
  await expect(
    page.getByRole('button', { name: 'Auf Updates prüfen' }),
  ).toBeEnabled();
  await expect(
    page.getByText('Öffentliches Update', { exact: true }),
  ).toBeVisible();
  expect(
    (await updateCalls(page)).every(
      (call) => Object.keys(call.args ?? {}).length === 0,
    ),
  ).toBe(true);
});

test('stored token and active method are visible in settings and connection dialog', async ({
  page,
}, testInfo) => {
  await setup(page, 'github-42');
  await openSettings(page);
  const stored = page.getByRole('region', { name: 'Verbundene Anmeldungen' });
  const token = stored
    .locator('.connected-auth-card')
    .filter({ has: page.getByText('fixture-user · Token', { exact: true }) });
  await expect(token).toContainText('Token hinterlegt · Aktiv für RepoTray');
  await expect(stored).toContainText(
    'Browser-Anmeldung gespeichert · Verbunden, nicht aktiv',
  );
  await page
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Verbundene Anmeldungen' }),
  ).toContainText('Token hinterlegt · Aktiv für RepoTray');
  await expect(
    page.getByRole('heading', { name: 'Weiteres Konto per Token verbinden' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Token prüfen und verbinden' }),
  ).toBeDisabled();
  await expect(page.getByLabel('GitHub-Token')).toHaveValue('');
  await page.setViewportSize({ width: 360, height: 840 });
  const dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await dialog.screenshot({
    path: testInfo.outputPath('stored-token-feedback-360.png'),
  });
});

test('using an already connected source makes it active without reconnecting or importing a token', async ({
  page,
}) => {
  await setup(page, 'github-42');
  await openSettings(page);
  await page
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'fixture-user · Browser für RepoTray verwenden',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'GitHub verbinden' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('status', { name: 'Aktives Konto', exact: true }),
  ).toContainText('fixture-user · Browser');
  const calls = await readCommands(page);
  expect(
    calls.some((cmd) =>
      ['connect_token', 'connect_local_auth', 'start_browser_auth'].includes(
        cmd,
      ),
    ),
  ).toBe(false);
});

test('active account and local method button review screenshots', async ({
  page,
}, testInfo) => {
  await setup(page, 'github-device-42');
  await expect(
    page.getByLabel('Aktives Konto auswählen', { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('status', { name: 'Aktives Konto', exact: true })
    .screenshot({ path: testInfo.outputPath('active-account-source.png') });
  await page.screenshot({
    path: testInfo.outputPath('active-account-panel.png'),
  });
  await page.setViewportSize({ width: 360, height: 840 });
  await page.screenshot({
    path: testInfo.outputPath('active-account-panel-360.png'),
  });
  await page.setViewportSize({ width: 500, height: 840 });
  await openSettings(page);
  await expect(
    page.getByRole('heading', { name: 'Aktives Konto', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Einstellungen', exact: true })
    .screenshot({ path: testInfo.outputPath('active-account-settings.png') });
  await page.setViewportSize({ width: 360, height: 840 });
  await page
    .getByRole('dialog', { name: 'Einstellungen', exact: true })
    .screenshot({
      path: testInfo.outputPath('active-account-settings-360.png'),
    });
  expect(
    await page
      .getByRole('region', { name: 'Aktives Konto', exact: true })
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await page.setViewportSize({ width: 500, height: 840 });
  await page
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  const option = page.getByRole('button', {
    name: 'Bestehende Anmeldung auf diesem PC verwenden',
    exact: true,
  });
  await expect(option).toHaveAttribute('aria-expanded', 'false');
  await page
    .getByRole('dialog', { name: 'GitHub verbinden' })
    .screenshot({ path: testInfo.outputPath('local-login-option.png') });
  const box = await option.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 360, height: 840 });
  await option.scrollIntoViewIfNeeded();
  await page
    .getByRole('dialog', { name: 'GitHub verbinden' })
    .screenshot({ path: testInfo.outputPath('local-login-option-360.png') });
  expect(
    await option.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  const narrow = await option.boundingBox();
  expect(narrow?.x).toBeGreaterThanOrEqual(0);
  expect((narrow?.x ?? 0) + (narrow?.width ?? 0)).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 500, height: 840 });
  await option.focus();
  await page.keyboard.press('Enter');
  await expect(option).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }),
  ).toBeVisible();
  expect(await readCommands(page)).not.toContain('discover_local_auth');
  await page
    .getByRole('dialog', { name: 'GitHub verbinden' })
    .screenshot({ path: testInfo.outputPath('local-login-expanded.png') });
  await page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }).click();
  await expect(
    page.getByText(
      'Keine nutzbare gh-Anmeldung gefunden. Melde dich mit „gh auth login“ an und prüfe erneut.',
    ),
  ).toBeVisible();
});
