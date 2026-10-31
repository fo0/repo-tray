import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
const key = 'repotray.activeAccount.v1';
async function setup(page: Page, saved: string | null = null) {
  await page.addInitScript(
    ({ fixture, saved, key }) => {
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
      const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
      let callback = 0;
      Object.assign(window, {
        isTauri: true,
        __accountCalls: calls,
        __updateDelay: 0,
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
        __TAURI_INTERNALS__: {
          invoke: async (cmd: string, args?: Record<string, unknown>) => {
            calls.push({ cmd, args });
            if (
              [
                'snapshot',
                'refresh_snapshot',
                'select_repos',
                'refresh_repositories',
              ].includes(cmd)
            )
              return structuredClone(snapshot);
            if (cmd === 'browser_auth_config') return { configured: true };
            if (cmd === 'discover_local_auth')
              return { accounts: [], notices: [] };
            if (cmd === 'check_update') {
              await new Promise((resolve) =>
                setTimeout(
                  resolve,
                  (window as unknown as { __updateDelay: number })
                    .__updateDelay,
                ),
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
                accounts: snapshot.accounts.filter(
                  (account) => account.id !== id,
                ),
                repos: snapshot.repos.filter((repo) => repo.accountId !== id),
                pins: snapshot.pins.filter((pin) => pin.accountId !== id),
              };
              return structuredClone(snapshot);
            }
            if (cmd === 'plugin:event|listen') return ++callback;
            return null;
          },
          transformCallback: () => ++callback,
          unregisterCallback() {},
          metadata: {
            currentWindow: { label: 'main' },
            currentWebview: { label: 'main', windowLabel: 'main' },
          },
        },
      });
    },
    { fixture, saved, key },
  );
  await page.goto('/');
}
async function settings(page: Page) {
  if (
    await page
      .getByRole('dialog', { name: 'Dein Workspace', exact: true })
      .isVisible()
  )
    return;
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
}
async function closeSettings(page: Page) {
  await page
    .getByRole('dialog', { name: 'Dein Workspace', exact: true })
    .getByRole('button', { name: 'Abbrechen', exact: true })
    .click();
}
async function chooseAccount(page: Page, id: string, keepOpen = false) {
  await settings(page);
  await page.getByRole('tab', { name: 'Konten', exact: true }).click();
  await page
    .getByLabel('Aktives Konto auswählen', { exact: true })
    .selectOption(id);
  if (!keepOpen) await closeSettings(page);
}
async function updateCalls(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        __accountCalls: { cmd: string; args?: Record<string, unknown> }[];
      }
    ).__accountCalls.filter((call) => call.cmd === 'check_update'),
  );
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
  await page
    .getByRole('button', { name: 'Konto in Einstellungen wählen', exact: true })
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
  expect((await updateCalls(page))[0].args).toEqual({});
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
  await settings(page);
  await expect(
    page.getByLabel('Aktives Konto auswählen', { exact: true }),
  ).toHaveValue('github-device-42');
  await closeSettings(page);
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
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
  expect(
    (
      await page.evaluate(
        () =>
          (window as unknown as { __accountCalls: { cmd: string }[] })
            .__accountCalls,
      )
    ).some((call) => call.cmd === 'dispatch_workflow'),
  ).toBe(false);
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
  await page
    .getByRole('button', { name: 'Konto in Einstellungen wählen', exact: true })
    .click();
  await expect(
    page.getByLabel('Aktives Konto auswählen', { exact: true }),
  ).toHaveValue('');
  expect(await updateCalls(page)).toHaveLength(1);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();
});

test('disconnecting another source preserves the active account; removing the active source requires a new settings choice', async ({
  page,
}) => {
  await setup(page, 'github-device-42');
  await settings(page);
  await page
    .getByRole('button', { name: 'fixture-user · Token trennen', exact: true })
    .click();
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
  await settings(page);
  await page
    .getByRole('button', {
      name: 'fixture-user · Browser trennen',
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel('Aktives Konto auswählen', { exact: true }),
  ).toHaveValue('');
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
  await settings(page);
  await page.getByRole('tab', { name: 'Updates' }).click();
  await expect(
    page.getByText('Öffentliches Update', { exact: true }),
  ).toBeVisible();
  await chooseAccount(page, 'github-device-42', true);
  await page.getByRole('tab', { name: 'Updates' }).click();
  await expect(
    page.getByText('Öffentliches Update', { exact: true }),
  ).toBeVisible();
  expect(await updateCalls(page)).toHaveLength(1);
  expect((await updateCalls(page))[0].args).toEqual({});
});

test('an in-flight public update check remains valid after switching the workflow account', async ({
  page,
}) => {
  await setup(page, 'github-42');
  await settings(page);
  await page.getByRole('tab', { name: 'Updates' }).click();
  await expect(
    page.getByText('Öffentliches Update', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => Object.assign(window, { __updateDelay: 600 }));
  await page.getByRole('button', { name: 'Auf Updates prüfen' }).click();
  await chooseAccount(page, 'github-device-42', true);
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
  await settings(page);
  const stored = page.getByRole('region', { name: 'Verbundene Anmeldungen' });
  const token = stored
    .locator('.connected-auth-card')
    .filter({ has: page.getByText('fixture-user · Token', { exact: true }) });
  await expect(token).toContainText('Token hinterlegt · Aktiv für RepoTray');
  await expect(stored).toContainText(
    'Browser-Anmeldung gespeichert · Verbunden, nicht aktiv',
  );
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
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
  await settings(page);
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
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
  const calls = await page.evaluate(
    () =>
      (window as unknown as { __accountCalls: { cmd: string }[] })
        .__accountCalls,
  );
  expect(
    calls.some((call) =>
      ['connect_token', 'connect_local_auth', 'start_browser_auth'].includes(
        call.cmd,
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
  await settings(page);
  await expect(
    page.getByRole('heading', { name: 'Aktives Konto', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Dein Workspace', exact: true })
    .screenshot({ path: testInfo.outputPath('active-account-settings.png') });
  await page.setViewportSize({ width: 360, height: 840 });
  await page
    .getByRole('dialog', { name: 'Dein Workspace', exact: true })
    .screenshot({
      path: testInfo.outputPath('active-account-settings-360.png'),
    });
  expect(
    await page
      .locator('.active-account-settings')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await page.setViewportSize({ width: 500, height: 840 });
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
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
  expect(
    (
      await page.evaluate(
        () =>
          (window as unknown as { __accountCalls: { cmd: string }[] })
            .__accountCalls,
      )
    ).some((call) => call.cmd === 'discover_local_auth'),
  ).toBe(false);
  await page
    .getByRole('dialog', { name: 'GitHub verbinden' })
    .screenshot({ path: testInfo.outputPath('local-login-expanded.png') });
  await page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }).click();
  await expect(
    page.getByText('Keine geeignete lokale API-Anmeldung verfügbar.'),
  ).toBeVisible();
});
