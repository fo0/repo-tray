import fixture from '../fixtures/demo.json' with { type: 'json' };
import { expect, test, type Locator, type Page } from './support/test';
import { openPage } from './support/demo';
import { installTauriMock } from './support/tauriMock';

// Relative and absolute times are asserted; a fixed zone keeps them stable.
test.use({ timezoneId: 'UTC' });

/** Three calendar days after the demo fixture's runs of 31.10.2026. */
const DEMO_NOW = Date.parse('2026-11-03T10:00:00Z');

const card = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true });
const pinRow = (page: Page, label: string) =>
  page
    .locator('.pin-row')
    .filter({ has: page.locator('.pin-label', { hasText: label }) });

/** Loads the browser demo with the clock paused at `now`. */
async function openDemoAt(page: Page, now: number) {
  await page.clock.install({ time: now - 5_000 });
  await page.goto('/');
  await page.clock.pauseAt(now);
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
}

/** Every element stays on one line: no taller than one line box. */
async function expectOneLine(target: Locator, max = 20) {
  const heights = await target.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().height),
  );
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights) expect(height).toBeLessThanOrEqual(max);
}

test.describe('demo', () => {
  test('a repository row says when it last ran, next to its status', async ({
    page,
  }) => {
    await openDemoAt(page, DEMO_NOW);
    const tools = card(page, 'example-org/runner-tools-demo');
    const when = tools.locator('.repository-meta time');
    await expect(when).toHaveText('vor 3 Tagen');
    await expect(when).toBeInViewport({ ratio: 1 });
    await expect(when).toHaveAttribute('datetime', '2026-10-31T09:41:00Z');
    await expect(when).toHaveAttribute(
      'title',
      'Letzter Run: 31.10.2026, 09:41 · Demo-Zeit',
    );
    await expect(tools.locator('.repository-status')).toHaveText('Wartet');
    // Open runs keep leading the status; the time is the latest start.
    const kit = card(page, 'demo-dev/launch-kit-demo');
    await expect(kit.locator('.repository-status')).toHaveText('2 aktiv');
    await expect(kit.locator('.repository-meta time')).toHaveAttribute(
      'datetime',
      '2026-10-31T09:44:00Z',
    );
    // Status and tag keep their room: on the read-only row the time drops
    // out whole; the row's name still reads it.
    const site = card(page, 'demo-dev/website-demo');
    await expect(site.locator('.repository-status')).toHaveText(
      'Fehlgeschlagen',
    );
    await expect(
      site.getByRole('button', { name: /Fehlgeschlagen.*vor 3 Tagen/ }),
    ).toHaveClass(/repository-toggle/);
    const shown = await page.locator('.repository-last').evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        const time = item.querySelector('time')!.getBoundingClientRect();
        const whole = time.right <= box.right + 0.5 && time.top >= box.top;
        const gone = time.top >= box.bottom;
        return whole ? 'whole' : gone ? 'gone' : 'cut';
      }),
    );
    expect(shown).not.toContain('cut');
    expect(shown).toContain('whole');
    // No run known: nothing is added.
    const api = card(page, 'example-org/api-gateway-demo');
    await expect(api.locator('.repository-status')).toHaveText(
      'Noch keine Runs',
    );
    await expect(api.locator('time')).toHaveCount(0);
    await expectOneLine(page.locator('.repository-meta'), 17);
  });

  test('times move with the shared minute clock', async ({ page }) => {
    await openDemoAt(page, Date.parse('2026-10-31T10:00:00Z'));
    const when = card(page, 'example-org/runner-tools-demo').locator(
      '.repository-meta time',
    );
    // The overview read the clock on load, 5 s before the pause.
    await expect(when).toHaveText('vor 18 Min.');
    await page.clock.runFor(60_000);
    await expect(when).toHaveText('vor 19 Min.');
  });

  test('a workflow row adds its last run, or that it runs', async ({
    page,
  }) => {
    await openDemoAt(page, DEMO_NOW);
    const site = card(page, 'demo-dev/website-demo');
    await site.locator('.repository-toggle').click();
    const preview = site.getByRole('button', {
      name: 'Preview site · Nur Lesen',
      exact: true,
    });
    await expect(preview.locator('small')).toHaveText(
      'Nur Lesen · vor 3 Tagen',
    );
    await expect(preview.locator('time')).toHaveAttribute(
      'datetime',
      '2026-10-31T09:35:00Z',
    );
    // The tooltip has the exact time; it is the row's description too.
    await expect(preview).toHaveAttribute(
      'title',
      'Preview site · Nur Lesen · Letzter Run: 31.10.2026, 09:35 · Demo-Zeit',
    );
    await expect(preview).toHaveAccessibleDescription(
      'Preview site · Nur Lesen · Letzter Run: 31.10.2026, 09:35 · Demo-Zeit',
    );

    const kit = card(page, 'demo-dev/launch-kit-demo');
    await kit.locator('.repository-toggle').click();
    // The name stays what it was; the running state is in its description.
    const desktop = kit.getByRole('button', {
      name: 'Desktop build · main',
      exact: true,
    });
    await expect(desktop.locator('small')).toHaveText('main · läuft');
    await expect(desktop.locator('.action-running')).toHaveAttribute(
      'data-tone',
      'run',
    );
    await expect(desktop.locator('.action-running')).toHaveCSS(
      'color',
      'rgb(108, 182, 255)',
    );
    await expect(desktop).toHaveAccessibleDescription(
      'Desktop build · main · Läuft gerade · Letzter Run: 31.10.2026, 09:42 · Demo-Zeit',
    );
    await expectOneLine(page.locator('.action-copy small'));
  });

  test('a favorite shows clearly that its workflow runs', async ({ page }) => {
    await openDemoAt(page, DEMO_NOW);
    for (const where of ['overview', 'favorites'] as const) {
      await openPage(page, where);
      const windows = pinRow(page, 'Windows build');
      const running = windows.locator('.pin-running');
      await expect(running).toHaveText('läuft');
      await expect(running).toHaveAttribute('data-tone', 'run');
      const open = windows.getByRole('button', {
        name: 'launch-kit-demo · Windows build starten…',
        exact: true,
      });
      const summary =
        /· main · demo-dev · Läuft gerade · Letzter Run: 31\.10\.2026, 09:42 · Demo-Zeit$/;
      await expect(open).toHaveAttribute('title', summary);
      await expect(open).toHaveAccessibleDescription(summary);
      const height = (await windows.boundingBox())!.height;
      expect(height).toBeLessThanOrEqual(36);
    }
    // The spinner turns; reduced motion keeps the still activity icon.
    const spinner = pinRow(page, 'Windows build').locator('.pin-spinner');
    await expect(spinner).toHaveCSS('animation-name', 'spin');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(spinner).toBeHidden();
    await expect(
      pinRow(page, 'Windows build').locator('.pin-running svg').nth(1),
    ).toBeVisible();
  });
});

test('native: last runs come from the history or the core’s lookup', async ({
  page,
}) => {
  const now = Date.parse('2026-11-01T09:00:00Z');
  await page.clock.install({ time: now - 5_000 });
  await page.addInitScript(() =>
    localStorage.setItem(
      'repotray.activeAccount.v1',
      JSON.stringify('demo-personal'),
    ),
  );
  await installTauriMock<{ fixture: typeof fixture }, object>(
    page,
    ({ fixture }) => {
      const base = structuredClone(fixture);
      const snapshot = {
        ...base,
        mode: 'live',
        stale: false,
        connectivity: 'online',
        message: undefined,
        // Only the completed Desktop build is in the history; Preview site
        // ran before it and is known from the core's lookup alone.
        runs: [
          {
            ...base.runs[4]!,
            createdAt: '2026-10-29T08:00:00Z',
            updatedAt: '2026-10-29T08:05:00Z',
          },
        ],
        workflows: base.workflows.map((workflow) =>
          workflow.id === 301
            ? { ...workflow, lastRunAt: '2026-10-27T12:00:00Z' }
            : workflow,
        ),
      };
      return (cmd) =>
        cmd === 'snapshot' || cmd === 'refresh_snapshot'
          ? structuredClone(snapshot)
          : null;
    },
    { arg: { fixture }, state: {} },
  );
  await page.goto('/');
  await page.clock.pauseAt(now);

  const windows = pinRow(page, 'Windows build');
  await expect(windows.locator('.pin-last')).toHaveText('vor 3 Tagen');
  await expect(windows.locator('.pin-running')).toHaveCount(0);
  await expect(
    windows.getByRole('button', {
      name: 'launch-kit-demo · Windows build starten…',
      exact: true,
    }),
  ).toHaveAccessibleDescription(
    'demo-dev/launch-kit-demo · Windows build · main · demo-dev · Personal · demo · Letzter Run: 29.10.2026, 08:00',
  );

  // No run in the history: the lookup speaks, without „Noch keine Runs“.
  const site = card(page, 'demo-dev/website-demo');
  await expect(site.locator('.repository-meta time')).toHaveText('vor 5 Tagen');
  await expect(site.locator('.repository-status')).toHaveCount(0);
  await site.locator('.repository-toggle').click();
  await expect(
    site.getByRole('button', { name: 'Preview site · Nur Lesen', exact: true }),
  ).toHaveAccessibleDescription(
    'Preview site · Nur Lesen · Letzter Run: 27.10.2026, 12:00',
  );
});
