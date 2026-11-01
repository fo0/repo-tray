import { expect, test } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { installTauriMock, readCommands } from './support/tauriMock';

type LoadMock = { failRefresh: boolean };

test('a native load error keeps refresh available until a retry succeeds', async ({
  page,
}) => {
  const mock = await installTauriMock<{ fixture: typeof fixture }, LoadMock>(
    page,
    ({ fixture }, state) =>
      (cmd) => {
        if (cmd === 'snapshot') throw 'GitHub ist gerade nicht erreichbar.';
        if (cmd === 'refresh_snapshot') {
          if (state.failRefresh) throw 'GitHub ist gerade nicht erreichbar.';
          return {
            ...structuredClone(fixture),
            mode: 'live',
            stale: false,
            connectivity: 'online',
            message: undefined,
          };
        }
        return null;
      },
    { arg: { fixture }, state: { failRefresh: true } },
  );
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Daten konnten nicht geladen werden' }),
  ).toBeVisible();
  await expect(
    page.getByText('Prüfe deine Verbindung und lade erneut (F5).'),
  ).toBeVisible();
  const refresh = page.getByRole('button', {
    name: 'Aktualisieren',
    exact: true,
  });
  const footer = page.getByRole('button', { name: 'Erneut laden' });
  await expect(refresh).toBeEnabled();
  await expect(footer).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeDisabled();

  await refresh.click();
  await expect(page.getByRole('alert')).toHaveText(
    'GitHub ist gerade nicht erreichbar.',
  );
  await expect(refresh).toBeEnabled();

  await mock.configure({ failRefresh: false });
  await page.keyboard.press('F5');
  await expect(
    page.getByRole('status').filter({ hasText: 'GitHub-Status aktualisiert.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Daten konnten nicht geladen werden' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^Aktualisieren · Stand / }),
  ).toBeEnabled();
  expect(
    (await readCommands(page)).filter((cmd) => cmd === 'refresh_snapshot'),
  ).toHaveLength(2);
  // The startup update check skipped by the failed load runs once on recovery.
  await expect
    .poll(async () =>
      (await readCommands(page)).filter((cmd) => cmd === 'check_update'),
    )
    .toHaveLength(1);
});
