import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import {
  configureMock,
  installTauriMock,
  readCalls,
} from './support/tauriMock';

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
        message: undefined,
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

/** Replaces the clipboard with a recorder; `fail` makes writes reject. */
async function recordClipboard(page: Page, fail = false) {
  await page.addInitScript((fail) => {
    const copied: string[] = [];
    Object.assign(window, { __copied: copied });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (fail) throw new DOMException('denied', 'NotAllowedError');
          copied.push(text);
        },
      },
    });
  }, fail);
}
const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
const notice = (page: Page, text: string) =>
  page.getByRole('status').filter({ hasText: text });

test('each run opens through the shell and copies its link without expanding', async ({
  page,
}) => {
  await recordClipboard(page);
  await openNativeActivity(page);
  const running = row(page, 8401);
  const toggle = running.locator('.run-button');
  const open = running.getByRole('link', {
    name: 'Run #8401 auf GitHub öffnen',
    exact: true,
  });
  const copy = running.getByRole('button', {
    name: 'Link zu Run #8401 kopieren',
    exact: true,
  });
  await toggle.focus();
  await page.keyboard.press('Tab');
  await expect(open).toBeFocused();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => readCalls(page, 'open_run'))
    .toEqual([{ cmd: 'open_run', args: { url: RUN_URL } }]);
  await page.keyboard.press('Tab');
  await expect(copy).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(notice(page, 'Link kopiert.')).toBeVisible();
  expect(await copied(page)).toEqual([RUN_URL]);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(page.context().pages()).toHaveLength(1);

  await configureMock<ActivityMock>(page, {
    openError: 'Browser konnte nicht geöffnet werden.',
  });
  await open.click();
  await expect(
    notice(page, 'Browser konnte nicht geöffnet werden.'),
  ).toBeVisible();
});

test('a refused clipboard explains that the link was not copied', async ({
  page,
}) => {
  await recordClipboard(page, true);
  await openNativeActivity(page);
  await row(page, 8405)
    .getByRole('button', { name: 'Link zu Run #8405 kopieren' })
    .click();
  await expect(notice(page, 'Link konnte nicht kopiert werden.')).toBeVisible();
  await expect(notice(page, 'Link kopiert.')).toHaveCount(0);
});

test('demo runs offer both row actions disabled with the demo hint', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  const running = row(page, 8401);
  for (const name of [
    'Run #8401 auf GitHub öffnen',
    'Link zu Run #8401 kopieren',
  ]) {
    const action = running.getByRole('button', { name, exact: true });
    await expect(action).toBeDisabled();
    await expect(action).toHaveAttribute(
      'title',
      'Demo-Runs haben keinen GitHub-Link',
    );
  }
});

test('the history note opens on demand from the info button', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  const note = page.getByText('Offene Runs werden automatisch aktualisiert.');
  const info = page.getByRole('button', {
    name: 'Hinweis zum Verlauf',
    exact: true,
  });
  await expect(page.locator('article.run').first()).toBeVisible();
  await expect(note).toBeHidden();
  await expect(info).toHaveAttribute('aria-expanded', 'false');
  await info.focus();
  await page.keyboard.press('Enter');
  await expect(info).toHaveAttribute('aria-expanded', 'true');
  await expect(note).toBeVisible();
  await expect(
    page.getByText('Bis zu 50 abgeschlossene Runs bleiben im Verlauf.'),
  ).toBeVisible();
  await info.click();
  await expect(note).toBeHidden();
});

for (const width of [360, 480]) {
  test(`row actions fit beside the run text at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 760 });
    await openNativeActivity(page);
    const layout = await page.evaluate(() =>
      [...document.querySelectorAll('article.run')].map((run) => {
        const box = (selector: string) =>
          run.querySelector(selector)!.getBoundingClientRect();
        const button = box('.run-button');
        const actions = box('.run-actions');
        const time = box('.run-time');
        const main = box('.run-main');
        const targets = [...run.querySelectorAll('.run-action')].map((action) =>
          action.getBoundingClientRect(),
        );
        return {
          rowHeight: button.height,
          insideRow:
            actions.bottom <= button.bottom && actions.right <= button.right,
          belowTime: actions.top >= time.bottom,
          besideText: actions.left >= main.right,
          minTarget: Math.min(
            ...targets.flatMap((target) => [target.width, target.height]),
          ),
        };
      }),
    );
    for (const item of layout) {
      expect(item.rowHeight).toBeLessThanOrEqual(79);
      expect(item.insideRow).toBe(true);
      expect(item.belowTime).toBe(true);
      expect(item.besideText).toBe(true);
      expect(item.minTarget).toBeGreaterThanOrEqual(24);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath(`activity-rows-${width}.png`),
    });
  });
}
