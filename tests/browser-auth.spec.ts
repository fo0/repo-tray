import { expect, test } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { installTauriMock, readCommands } from './support/tauriMock';

for (const configured of [false, true]) {
  test(`browser sign-in is paused even with publisher configuration ${configured}`, async ({
    page,
  }) => {
    await installTauriMock(
      page,
      ({ fixture, configured }) =>
        (cmd) => {
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
          return null;
        },
      { arg: { fixture, configured }, state: {} },
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
    const calls = await readCommands(page);
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
