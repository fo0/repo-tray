import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { installTauriMock } from './support/tauriMock';

// Relative and absolute times are asserted; a fixed zone keeps them stable.
test.use({ timezoneId: 'UTC' });

const NOW = Date.parse('2026-11-01T09:00:00Z');
const RUN_URL = 'https://github.com/demo-dev/launch-kit-demo/actions/runs/8401';
type ActivityMock = { openError: string };

/** Native panel (labelled IPC mock) with one running and one finished run. */
async function openNativeActivity(page: Page) {
  await page.clock.install({ time: NOW - 5_000 });
  await page.addInitScript(() =>
    localStorage.setItem(
      'repotray.activeAccount.v1',
      JSON.stringify('demo-personal'),
    ),
  );
  await installTauriMock<
    { fixture: typeof fixture; now: number; url: string },
    ActivityMock
  >(
    page,
    ({ fixture, now, url }, state) => {
      const ago = (minutes: number) =>
        new Date(now - minutes * 60_000).toISOString();
      const snapshot = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        updatedAt: ago(0),
        runs: [
          {
            ...fixture.runs[0],
            createdAt: ago(3),
            updatedAt: ago(2),
            htmlUrl: url,
          },
          {
            ...fixture.runs[4],
            createdAt: ago(125),
            updatedAt: ago(120),
            htmlUrl: url.replace(/8401$/, '8405'),
          },
        ],
      };
      return (cmd) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(snapshot);
        if (cmd === 'open_run' && state.openError) throw state.openError;
        return null;
      };
    },
    { arg: { fixture, now: NOW, url: RUN_URL }, state: { openError: '' } },
  );
  await page.goto('/');
  // Paused, so the view reads exactly NOW when it subscribes to the clock.
  await page.clock.pauseAt(NOW);
  await page.getByRole('button', { name: /^Aktivität/ }).click();
}

const row = (page: Page, id: number) =>
  page.locator('article.run').filter({ hasText: `#${id}` });

test('live runs show relative times that tick with one shared minute clock', async ({
  page,
}) => {
  await openNativeActivity(page);
  const running = row(page, 8401);
  const finished = row(page, 8405);
  const time = running.locator('time');
  await expect(time).toHaveText('vor 3 Min.');
  await expect(time).toHaveAttribute(
    'datetime',
    new Date(NOW - 3 * 60_000).toISOString(),
  );
  await expect(time).toHaveAttribute('title', 'Gestartet: 01.11.2026, 08:57');
  await expect(running.locator('.run-duration')).toHaveText('3:00 min');
  await expect(finished.locator('time')).toHaveText('vor 2 Std.');
  await expect(finished.locator('time')).toHaveAttribute(
    'title',
    'Beendet: 01.11.2026, 07:00',
  );
  await expect(finished.locator('.run-duration')).toHaveText('5:00 min');

  await page.clock.runFor(60_000);
  await expect(time).toHaveText('vor 4 Min.');
  await expect(running.locator('.run-duration')).toHaveText('4:00 min');
  await expect(
    running.getByRole('button', { name: /· Läuft · gestartet vor 4 Min\.$/ }),
  ).toBeVisible();
  await expect(finished.locator('time')).toHaveText('vor 2 Std.');
  await expect(finished.locator('.run-duration')).toHaveText('5:00 min');
});

test('demo runs keep their fixture durations and mark the demo time', async ({
  page,
}) => {
  const demoNow = Date.parse('2026-10-31T10:00:00Z');
  await page.clock.install({ time: demoNow - 5_000 });
  await page.goto('/');
  await page.clock.pauseAt(demoNow);
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  const running = row(page, 8401);
  await expect(running.locator('time')).toHaveText('vor 18 Min.');
  await expect(running.locator('time')).toHaveAttribute(
    'title',
    'Gestartet: 31.10.2026, 09:42 · Demo-Zeit',
  );
  await expect(running.locator('.run-duration')).toHaveText('1:00 min');
  await page.clock.runFor(60_000);
  await expect(running.locator('time')).toHaveText('vor 19 Min.');
  await expect(running.locator('.run-duration')).toHaveText('1:00 min');
  await expect(row(page, 8404).locator('time')).toHaveText('vor 25 Min.');
});
