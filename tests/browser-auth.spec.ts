import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };

async function setup(page: Page, configured = true) {
  await page.addInitScript(
    ({ fixture, configured }) => {
      let callback = 0;
      let generation = 0;
      const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
      const empty = {
        ...structuredClone(fixture),
        accounts: [],
        repos: [],
        workflows: [],
        runs: [],
        pins: [],
        mode: 'live',
        stale: false,
        connectivity: 'online',
      };
      Object.assign(window, {
        isTauri: true,
        __browserCalls: calls,
        __browserOutcome: 'pending',
        __browserDelay: 0,
        __browserBeginDelay: 0,
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        __TAURI_INTERNALS__: {
          invoke: async (cmd: string, args?: Record<string, unknown>) => {
            calls.push({ cmd, args });
            const state = window as unknown as {
              __browserOutcome: string;
              __browserDelay: number;
              __browserBeginDelay: number;
            };
            if (cmd === 'refresh_repositories')
              return {
                ...structuredClone(fixture),
                mode: 'live',
                stale: false,
                connectivity: 'online',
                accounts: [
                  {
                    id: 'github-device-42',
                    login: 'fixture-user',
                    label: 'GitHub · Browser',
                  },
                ],
              };
            if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
              return structuredClone(empty);
            if (cmd === 'browser_auth_config') return { configured };
            if (cmd === 'start_browser_auth') {
              const ticket = ++generation;
              await new Promise((resolve) =>
                setTimeout(resolve, state.__browserBeginDelay),
              );
              return {
                flowId: ticket,
                status: {
                  state: 'awaitingAuthorization',
                  userCode: 'ABCD-EFGH',
                  verificationUri: 'https://github.com/login/device',
                  expiresAt: Math.floor(Date.now() / 1000) + 900,
                  nextPollAt: Date.now() / 1000 + 0.3,
                },
              };
            }
            if (cmd === 'cancel_connect') {
              generation++;
              return null;
            }
            if (cmd === 'poll_browser_auth') {
              const ticket = args?.flowId;
              const outcome = state.__browserOutcome;
              await new Promise((resolve) =>
                setTimeout(resolve, state.__browserDelay),
              );
              if (outcome === 'success')
                return {
                  flowId: ticket,
                  status: { state: 'completed' },
                  snapshot: {
                    ...structuredClone(fixture),
                    mode: 'live',
                    stale: false,
                    connectivity: 'online',
                    accounts: [
                      {
                        id: 'github-device-42',
                        login: 'fixture-user',
                        label: 'GitHub · Browser',
                      },
                    ],
                  },
                };
              if (outcome === 'network')
                return {
                  flowId: ticket,
                  status: {
                    state: 'awaitingAuthorization',
                    userCode: 'ABCD-EFGH',
                    verificationUri: 'https://github.com/login/device',
                    expiresAt: Math.floor(Date.now() / 1000) + 900,
                    nextPollAt: Date.now() / 1000 + 0.3,
                  },
                  message:
                    'GitHub ist gerade nicht erreichbar. RepoTray versucht es weiter, solange der Code gültig ist.',
                };
              return {
                flowId: ticket,
                status:
                  outcome === 'pending'
                    ? {
                        state: 'awaitingAuthorization',
                        userCode: 'ABCD-EFGH',
                        verificationUri: 'https://github.com/login/device',
                        expiresAt: Math.floor(Date.now() / 1000) + 900,
                        nextPollAt: Date.now() / 1000 + 0.3,
                      }
                    : { state: outcome },
              };
            }
            if (cmd === 'connect_token')
              return {
                ...structuredClone(fixture),
                mode: 'live',
                accounts: [
                  {
                    id: 'github-7',
                    login: 'fixture-pat',
                    label: 'GitHub · Token',
                  },
                ],
              };
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
    { fixture, configured },
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
}

test('missing publisher configuration stays explicit and opens no browser', async ({
  page,
}) => {
  await setup(page, false);
  await expect(
    page.getByRole('button', { name: /Mit GitHub anmelden/ }),
  ).toBeDisabled();
  await expect(
    page.getByText(/Für diese App-Version fehlen noch Client-ID/),
  ).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (window as unknown as { __browserCalls: { cmd: string }[] })
        .__browserCalls,
  );
  expect(
    calls.some(
      (c) => c.cmd === 'start_browser_auth' || c.cmd === 'open_browser_auth',
    ),
  ).toBe(false);
});

test('device code login automatically detects authorization and keeps secrets outside IPC and storage', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page);
  await page
    .getByRole('button', { name: 'Mit GitHub anmelden', exact: true })
    .click();
  await expect(page.getByText('ABCD-EFGH', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Code kopieren', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Code kopiert' }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'ABCD-EFGH',
  );
  await page.evaluate(() =>
    Object.assign(window, { __browserOutcome: 'success' }),
  );
  await expect(
    page.getByRole('heading', { name: 'Dein Workspace', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Repository-Freigabe auf GitHub ändern' })
    .click();
  await page
    .getByRole('button', { name: 'Repository-Liste aktualisieren' })
    .click();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          __browserCalls: { cmd: string; args?: Record<string, unknown> }[];
        }
      ).__browserCalls,
  );
  expect(calls.some((c) => c.cmd === 'open_browser_auth')).toBe(true);
  expect(calls.some((c) => c.cmd === 'open_browser_installation')).toBe(true);
  expect(calls.some((c) => c.cmd === 'refresh_repositories')).toBe(true);
  expect(
    calls
      .filter((c) => c.cmd === 'poll_browser_auth')
      .every((c) => Object.keys(c.args ?? {}).join() === 'flowId'),
  ).toBe(true);
  expect(
    calls.some(
      (c) => c.cmd === 'connect_token' || c.cmd === 'dispatch_workflow',
    ),
  ).toBe(false);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain('ABCD-EFGH');
});

test('cancelled pending response cannot overwrite a newer PAT session', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() =>
    Object.assign(window, { __browserOutcome: 'success', __browserDelay: 600 }),
  );
  await page
    .getByRole('button', { name: 'Mit GitHub anmelden', exact: true })
    .click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as unknown as { __browserCalls: { cmd: string }[] }
          ).__browserCalls.filter((c) => c.cmd === 'poll_browser_auth').length,
      ),
    )
    .toBeGreaterThan(0);
  await page
    .getByRole('button', { name: 'Anmeldung abbrechen', exact: true })
    .click();
  await expect(page.getByText(/Anmeldung abgebrochen/)).toBeVisible();
  await page.getByLabel('GitHub-Token').fill('synthetic-pat');
  await page
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Dein Workspace', exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(700);
  await expect(
    page.getByRole('button', { name: /^fixture-pat.*trennen$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^fixture-user.*trennen$/ }),
  ).toHaveCount(0);
});

test('cancelling a delayed start does not reopen GitHub or revive the flow', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() =>
    Object.assign(window, { __browserBeginDelay: 600 }),
  );
  await page
    .getByRole('button', { name: 'Mit GitHub anmelden', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Anmeldung abbrechen', exact: true })
    .click();
  await page.waitForTimeout(700);
  await expect(page.getByText(/Anmeldung abgebrochen/)).toBeVisible();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __browserCalls: { cmd: string }[] }
      ).__browserCalls.some((c) => c.cmd === 'open_browser_auth'),
    ),
  ).toBe(false);
});

for (const outcome of ['expired', 'denied', 'network']) {
  test(`handles ${outcome} honestly`, async ({ page }) => {
    await setup(page);
    await page.evaluate(
      (outcome) => Object.assign(window, { __browserOutcome: outcome }),
      outcome,
    );
    await page
      .getByRole('button', { name: 'Mit GitHub anmelden', exact: true })
      .click();
    await expect(
      page.getByText(
        outcome === 'expired'
          ? /Code abgelaufen/
          : outcome === 'denied'
            ? /Freigabe bei GitHub abgelehnt/
            : /GitHub ist gerade nicht erreichbar/,
      ),
    ).toBeVisible();
    if (outcome === 'network')
      await expect(page.getByText('ABCD-EFGH', { exact: true })).toBeVisible();
  });
}

test('review screenshots cover idle, waiting, code, error and cancellation', async ({
  page,
}, testInfo) => {
  await setup(page);
  const capture = async (name: string) => {
    const rectangles = await page.locator('.browser-auth').evaluate((element) =>
      Array.from(element.children)
        .map((child) => {
          const rect = child.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, height: rect.height };
        })
        .filter((rect) => rect.height > 0),
    );
    for (let index = 1; index < rectangles.length; index++) {
      expect(rectangles[index].top).toBeGreaterThanOrEqual(
        rectangles[index - 1].bottom - 1,
      );
    }
    const path = testInfo.outputPath(`browser-${name}.png`);
    await page
      .getByRole('dialog', { name: 'GitHub verbinden' })
      .screenshot({ path, animations: 'disabled' });
    await testInfo.attach(name, { path, contentType: 'image/png' });
  };
  await capture('normal');
  await page.evaluate(() =>
    Object.assign(window, { __browserBeginDelay: 1200 }),
  );
  await page
    .getByRole('button', { name: 'Mit GitHub anmelden', exact: true })
    .click();
  await expect(
    page.getByText('GitHub-Anmeldung wird vorbereitet …'),
  ).toBeVisible();
  await capture('wait');
  await expect(page.getByText('ABCD-EFGH', { exact: true })).toBeVisible();
  await capture('code');
  await page
    .getByRole('button', { name: 'Anmeldung abbrechen', exact: true })
    .click();
  await expect(page.getByText(/Anmeldung abgebrochen/)).toBeVisible();
  await capture('cancel');
  await page.evaluate(() =>
    Object.assign(window, {
      __browserBeginDelay: 0,
      __browserOutcome: 'denied',
    }),
  );
  await page
    .getByRole('button', { name: 'Erneut mit GitHub anmelden' })
    .click();
  await expect(page.getByText(/Freigabe bei GitHub abgelehnt/)).toBeVisible();
  await capture('error');
});
