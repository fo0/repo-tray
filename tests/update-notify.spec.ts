import { expect, test } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import {
  type TauriMock,
  installTauriMock,
  readCalls,
  readCommands,
} from './support/tauriMock';

/** Labelled IPC mock of an unsigned build: no updater key, notify-only updates. */
type NotifyMock = { current: boolean; openFail: boolean };
let mock: TauriMock<NotifyMock>;

const VERSION = '2026.1101.905';

test.beforeEach(async ({ page }) => {
  mock = await installTauriMock<
    { fixture: typeof fixture; version: string },
    NotifyMock
  >(
    page,
    ({ fixture, version }, state) => {
      const snapshot = {
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
      return async (cmd) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(snapshot);
        if (cmd === 'check_update')
          return state.current
            ? null
            : {
                mode: 'notify',
                version,
                notes: 'Synthetischer Changelog · nur IPC-Mock',
                date: '2026-11-01T09:05:00Z',
              };
        if (cmd === 'open_release_page') {
          if (state.openFail) throw 'Browser konnte nicht geöffnet werden.';
          return null;
        }
        if (cmd === 'download_update' || cmd === 'install_update')
          throw 'Unsigned builds never download or install updates.';
        return null;
      };
    },
    {
      arg: { fixture, version: VERSION },
      state: { current: false, openFail: false },
    },
  );
  await page.goto('/');
});

test('the silent check announces a newer unsigned release and opens only its release page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await expect(page.getByText(`RepoTray ${VERSION} verfügbar`)).toBeVisible();
  await page.getByRole('button', { name: 'Update ansehen' }).click();
  // The update dot is announced as part of the tab name, not as bare decoration.
  await expect(
    page.getByRole('tab', { name: /^Updates\s*Update verfügbar$/ }),
  ).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('region', { name: 'RepoTray aktuell halten' });
  await expect(
    panel.getByText(`Version ${VERSION}`, { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('veröffentlicht am 01.11.2026')).toBeVisible();
  await expect(
    panel.getByText('Updates werden in dieser Version manuell installiert'),
  ).toBeVisible();
  await expect(
    panel.getByText('Synthetischer Changelog · nur IPC-Mock'),
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Update herunterladen' }),
  ).toHaveCount(0);
  await expect(panel.getByRole('list', { name: 'Update-Ablauf' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(
    await panel.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await panel.getByRole('button', { name: 'Release-Seite öffnen' }).click();
  await expect
    .poll(async () =>
      (await readCalls(page, 'open_release_page')).map((call) => call.args),
    )
    .toEqual([{ version: VERSION }]);
  const commands = await readCommands(page);
  expect(commands).not.toContain('download_update');
  expect(commands).not.toContain('install_update');
});

test('a failed release-page open is reported and can be retried', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Update ansehen' }).click();
  const open = page.getByRole('button', { name: 'Release-Seite öffnen' });
  await mock.configure({ openFail: true });
  await open.click();
  await expect(page.getByRole('alert')).toContainText(
    'Browser konnte nicht geöffnet werden.',
  );
  await mock.configure({ openFail: false });
  await open.click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect
    .poll(async () => (await readCalls(page, 'open_release_page')).length)
    .toBe(2);
});

test('a current unsigned build reports calmly and promises no in-app installation', async ({
  page,
}) => {
  await mock.configure({ current: true });
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Updates' }).click();
  await page.getByRole('button', { name: 'Auf Updates prüfen' }).click();
  const panel = page.getByRole('region', { name: 'RepoTray aktuell halten' });
  await expect(
    panel.getByText('Du verwendest die aktuelle Version.'),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(panel).not.toContainText('installieren');
  await expect(
    panel.getByRole('button', { name: 'Release-Seite öffnen' }),
  ).toHaveCount(0);
  expect(await readCommands(page)).not.toContain('open_release_page');
});
