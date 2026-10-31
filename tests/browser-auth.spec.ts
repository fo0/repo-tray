import { expect, test } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };

for (const configured of [false, true]) {
  test(`browser sign-in is paused even with publisher configuration ${configured}`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ fixture, configured }) => {
        const calls: string[] = [];
        let callback = 0;
        Object.assign(window, {
          isTauri: true,
          __pausedBrowserCalls: calls,
          __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
          __TAURI_INTERNALS__: {
            invoke: async (cmd: string) => {
              calls.push(cmd);
              if (cmd === 'snapshot')
                return {
                  ...fixture,
                  accounts: [],
                  repos: [],
                  workflows: [],
                  runs: [],
                  pins: [],
                  mode: 'live',
                };
              if (cmd === 'browser_auth_config') return { configured };
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
      { fixture, configured },
    );
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Einstellungen', exact: true })
      .click();
    await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
    await expect(
      page.getByRole('button', { name: /Mit GitHub anmelden/ }),
    ).toBeDisabled();
    await expect(
      page.getByText(
        /Die Browser-Anmeldung \/ GitHub App ist vorübergehend deaktiviert/,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Token prüfen und verbinden' }),
    ).toBeDisabled();
    await page.getByLabel('GitHub-Token').fill('synthetic-test-value');
    await expect(
      page.getByRole('button', { name: 'Token prüfen und verbinden' }),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', {
        name: 'Bestehende Anmeldung auf diesem PC verwenden',
      }),
    ).toBeEnabled();
    const calls = await page.evaluate(
      () =>
        (window as unknown as { __pausedBrowserCalls: string[] })
          .__pausedBrowserCalls,
    );
    expect(
      calls.some((cmd) =>
        [
          'browser_auth_config',
          'start_browser_auth',
          'poll_browser_auth',
          'open_browser_auth',
          'connect_token',
          'discover_local_auth',
        ].includes(cmd),
      ),
    ).toBe(false);
    expect(page.context().pages()).toHaveLength(1);
  });
}
