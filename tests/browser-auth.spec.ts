import { expect, test } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { chooseToken, connectDialog } from './support/connect';
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
    await page
      .getByRole('button', { name: 'GitHub-Konto verbinden', exact: true })
      .click();
    const dialog = connectDialog(page);
    const browser = dialog.getByRole('radio', {
      name: /^Mit GitHub anmelden/,
    });
    await expect(browser).toBeDisabled();
    await expect(browser).toHaveAccessibleName(
      'Mit GitHub anmelden Vorübergehend deaktiviert',
    );
    await expect(
      dialog.getByRole('radio', {
        name: /^Bestehende Anmeldung auf diesem PC verwenden/,
      }),
    ).toBeEnabled();
    await chooseToken(page);
    const connect = dialog.getByRole('button', {
      name: 'Verbinden',
      exact: true,
    });
    await expect(connect).toBeDisabled();
    await dialog.getByLabel('GitHub-Token').fill('synthetic-test-value');
    await expect(connect).toBeEnabled();
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
