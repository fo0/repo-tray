import { expect, test } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ fixture }) => {
      let callback = 0;
      const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
      const empty = {
        ...structuredClone(fixture),
        accounts: [],
        repos: [],
        workflows: [],
        runs: [],
        pins: [],
        mode: 'live',
        connectivity: 'online',
        stale: false,
      };
      const accounts = [
        {
          source: 'gh',
          host: 'github.com',
          login: 'fixture-alex',
          usable: true,
          active: true,
          detail: 'API-Anmeldung bestätigt',
          actionsRead: 'Scope repo vorhanden; Repository-Zugriff ungeprüft.',
          actionsWrite: 'Actions starten: pro Repository ungeprüft.',
        },
        {
          source: 'gh',
          host: 'github.com',
          login: 'fixture-sam',
          usable: true,
          active: false,
          detail: 'API-Anmeldung bestätigt',
          actionsRead: 'Scopes nicht auslesbar.',
          actionsWrite: 'Actions starten: pro Repository ungeprüft.',
        },
        {
          source: 'gcm',
          host: 'github.com',
          login: 'fixture-gcm',
          usable: false,
          active: false,
          detail: 'Git-Konto; API-Übernahme nicht unterstützt.',
          actionsRead: 'Git belegt keine Actions-API-Rechte.',
          actionsWrite: 'Nicht nachgewiesen.',
        },
      ];
      Object.assign(window, {
        isTauri: true,
        __localCalls: calls,
        __localScanDelay: 0,
        __localEmpty: false,
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        __TAURI_INTERNALS__: {
          invoke: async (cmd: string, args?: Record<string, unknown>) => {
            calls.push({ cmd, args });
            if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
              return structuredClone(empty);
            if (cmd === 'discover_local_auth') {
              const state = window as unknown as {
                __localScanDelay: number;
                __localEmpty: boolean;
              };
              await new Promise((resolve) =>
                setTimeout(resolve, state.__localScanDelay),
              );
              return {
                accounts: state.__localEmpty ? [] : accounts,
                notices: [
                  'Git erkannt; keine API-Anmeldung belegt.',
                  'GCM-Credentials werden nicht exportiert.',
                ],
              };
            }
            if (cmd === 'connect_local_auth') {
              if (args?.login !== 'fixture-sam' || args?.confirmImport !== true)
                throw 'Selection mismatch';
              return {
                ...structuredClone(fixture),
                mode: 'live',
                connectivity: 'online',
                stale: false,
                accounts: [
                  {
                    id: 'github-gh-42',
                    login: 'fixture-sam',
                    label: 'GitHub · gh CLI (Kopie)',
                  },
                ],
              };
            }
            if (cmd === 'plugin:event|listen') return ++callback;
            return null;
          },
          transformCallback: () => ++callback,
          unregisterCallback: () => {},
          metadata: {
            currentWindow: { label: 'main' },
            currentWebview: { label: 'main', windowLabel: 'main' },
          },
        },
      });
    },
    { fixture },
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
});

test('local account access requires a click, explicit choice and consent before secret import', async ({
  page,
}) => {
  const calls = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __localCalls: { cmd: string; args?: Record<string, unknown> }[];
          }
        ).__localCalls,
    );
  expect((await calls()).some((c) => c.cmd.includes('local_auth'))).toBe(false);
  await page
    .getByText('Bestehende Anmeldung auf diesem PC verwenden', { exact: true })
    .click();
  expect((await calls()).some((c) => c.cmd.includes('local_auth'))).toBe(false);
  await page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }).click();
  const select = page.getByLabel('Lokales Konto · gh CLI');
  await expect(select).toHaveValue('');
  await expect(select.locator('option')).toHaveCount(3);
  await select.selectOption('fixture-sam');
  await expect(page.getByText('Scopes nicht auslesbar.')).toBeVisible();
  await expect(
    page.getByText(/Actions starten: pro Repository ungeprüft\./),
  ).toBeVisible();
  const connect = page.getByRole('button', {
    name: 'gh-Konto mit RepoTray verbinden',
  });
  await expect(connect).toBeDisabled();
  expect((await calls()).some((c) => c.cmd === 'connect_local_auth')).toBe(
    false,
  );
  await page
    .getByRole('checkbox', {
      name: 'Ich möchte dieses gh-Konto in RepoTray verwenden',
    })
    .check();
  await connect.click();
  await expect(
    page.getByRole('heading', { name: 'Dein Workspace', exact: true }),
  ).toBeVisible();
  expect(
    (await calls()).find((c) => c.cmd === 'connect_local_auth')?.args,
  ).toEqual({ login: 'fixture-sam', confirmImport: true });
  expect(
    JSON.stringify(await page.evaluate(() => ({ ...localStorage }))),
  ).not.toContain('fixture-sam');
  expect(
    (await calls()).some(
      (c) => c.cmd === 'connect_token' || c.cmd === 'dispatch_workflow',
    ),
  ).toBe(false);
});

test('unavailable sources stay unavailable and cancellation discards late process results', async ({
  page,
}) => {
  await page.evaluate(() => Object.assign(window, { __localScanDelay: 400 }));
  await page
    .getByText('Bestehende Anmeldung auf diesem PC verwenden', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }).click();
  await page
    .getByRole('button', { name: 'Prüfung abbrechen', exact: true })
    .click();
  await page.waitForTimeout(500);
  await expect(page.getByLabel('Lokales Konto · gh CLI')).toHaveCount(0);
  await page.evaluate(() =>
    Object.assign(window, { __localScanDelay: 0, __localEmpty: true }),
  );
  await page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }).click();
  await expect(
    page.getByText('Keine geeignete lokale API-Anmeldung verfügbar.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'gh-Konto mit RepoTray verbinden',
    }),
  ).toHaveCount(0);
  await page.getByText('Weitere lokale Quellen', { exact: true }).click();
  await expect(
    page.getByText('Git erkannt; keine API-Anmeldung belegt.'),
  ).toBeVisible();
});

test('discovery shows recognized rather than connected until consent, then retains active source feedback', async ({
  page,
}, testInfo) => {
  await expect(
    page.getByText('Noch kein gh-Konto in RepoTray verbunden'),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Bestehende Anmeldung auf diesem PC verwenden',
    })
    .click();
  await page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }).click();
  await page.getByLabel('Lokales Konto · gh CLI').selectOption('fixture-sam');
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'In gh erkannt · noch nicht mit RepoTray verbunden' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'gh-Konto mit RepoTray verbinden' }),
  ).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'Ich möchte dieses gh-Konto in RepoTray verwenden',
    })
    .check();
  await page
    .getByRole('button', { name: 'gh-Konto mit RepoTray verbinden' })
    .click();
  await expect(
    page.getByRole('region', { name: 'Verbundene Anmeldungen' }),
  ).toContainText('gh-Anmeldung übernommen · Aktiv für RepoTray');
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
  await expect(
    dialog.getByRole('region', { name: 'Verbundene Anmeldungen' }),
  ).toContainText('fixture-sam · gh CLI (Kopie)');
  await expect(
    dialog.getByText('1 gh-Konto in RepoTray verbunden'),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Bestehende Anmeldung auf diesem PC verwenden',
    })
    .click();
  await page.getByRole('button', { name: 'Lokale Anmeldungen prüfen' }).click();
  await page.getByLabel('Lokales Konto · gh CLI').selectOption('fixture-sam');
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'In RepoTray verbunden · aktives Konto' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'gh-Konto erneut übernehmen' }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 360, height: 840 });
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await dialog.screenshot({
    path: testInfo.outputPath('connected-gh-feedback-360.png'),
  });
});
