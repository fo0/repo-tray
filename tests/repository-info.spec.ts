import { expect, test, type Page } from './support/test';
import { openNative, repoRow } from './support/nativeRepos';
import { readCalls } from './support/tauriMock';

// Relative and absolute times are asserted; a fixed zone keeps them stable.
test.use({ timezoneId: 'UTC' });

/** Three calendar days after the demo fixture's runs of 31.10.2026. */
const DEMO_NOW = Date.parse('2026-11-03T10:00:00Z');

/** Loads the browser demo with the clock paused at `now`. */
async function openDemoAt(page: Page, now: number) {
  await page.clock.install({ time: now - 5_000 });
  await page.goto('/');
  await page.clock.pauseAt(now);
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
}

test('the overview lists repositories by their latest run or push', async ({
  page,
}) => {
  await openDemoAt(page, DEMO_NOW);
  // Runs first, then the run-less ones by last push; the two oldest pushes
  // (ci-templates, metrics-dashboard) are beyond the overview's 10.
  await expect(page.locator('.repository-card')).toHaveCount(10);
  expect(
    await page
      .locator('.repository-card')
      .evaluateAll((cards) => cards.map((card) => card.ariaLabel)),
  ).toEqual([
    'demo-dev/launch-kit-demo',
    'example-org/runner-tools-demo',
    'demo-dev/website-demo',
    'example-org/api-gateway-demo',
    'example-org/docs-portal-demo',
    'example-org/infra-modules-demo',
    'example-org/mobile-app-demo',
    'example-org/billing-service-demo',
    'example-org/search-index-demo',
    'example-org/design-tokens-demo',
  ]);
});

test('an expanded repository starts with its branch, last push and GitHub link', async ({
  page,
}) => {
  await openDemoAt(page, DEMO_NOW);
  const kit = repoRow(page, 'demo-dev/launch-kit-demo');
  // Only an open repository has the line.
  await expect(kit.locator('.repository-info')).toHaveCount(0);
  await kit.locator('.repository-toggle').click();
  const info = kit.locator('.repository-info');
  await expect(info).toBeVisible();
  await expect(info.locator('.branch-chip')).toHaveText('main');
  const push = info.locator('time');
  await expect(push).toHaveText('Push vor 3 Tagen');
  await expect(push).toHaveAttribute(
    'title',
    'Letzter Push: 31.10.2026, 09:40 · Demo-Zeit',
  );
  // Demo repositories have no real page: the button says why.
  const github = info.getByRole('button', {
    name: 'demo-dev/launch-kit-demo auf GitHub öffnen',
    exact: true,
  });
  await expect(github).toBeDisabled();
  await expect(github).toHaveText('GitHub');
  await expect(github).toHaveAttribute(
    'title',
    'Demo-Repositories haben keinen GitHub-Link',
  );
  // One quiet line above the workflows, the button at its right end.
  const layout = await kit.evaluate((card) => {
    const box = (selector: string) =>
      card.querySelector(selector)!.getBoundingClientRect();
    const info = box('.repository-info');
    return {
      first: card.querySelector('.repository-actions > *')!.className,
      infoHeight: info.height,
      actionTop: box('.repository-action').top,
      infoBottom: info.bottom,
      gap: info.right - box('.repository-github').right,
      chipTop: box('.branch-chip').top,
      buttonTop: box('.repository-github').top,
    };
  });
  expect(layout.first).toBe('repository-info');
  expect(layout.infoHeight).toBeLessThanOrEqual(33);
  expect(layout.actionTop).toBeGreaterThanOrEqual(layout.infoBottom);
  expect(layout.gap).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.chipTop - layout.buttonTop)).toBeLessThanOrEqual(4);
  await kit.locator('.repository-toggle').click();
  await expect(info).toHaveCount(0);
});

test('at 360 px the line stays one line', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await openDemoAt(page, DEMO_NOW);
  const site = repoRow(page, 'demo-dev/website-demo');
  await site.locator('.repository-toggle').click();
  const info = site.locator('.repository-info');
  await expect(info.locator('time')).toHaveText('Push vor 4 Tagen');
  const box = (await info.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(33);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('natively the GitHub button opens the repository page through the shell', async ({
  page,
}) => {
  await openNative(page);
  const site = repoRow(page, 'demo-dev/website-demo');
  await site.locator('.repository-toggle').click();
  const github = site.getByRole('link', {
    name: 'demo-dev/website-demo auf GitHub öffnen',
    exact: true,
  });
  await expect(github).toHaveAttribute(
    'href',
    'https://github.com/demo-dev/website-demo',
  );
  await github.click();
  await expect
    .poll(() => readCalls(page, 'open_repo'))
    .toEqual([
      {
        cmd: 'open_repo',
        args: { url: 'https://github.com/demo-dev/website-demo' },
      },
    ]);
  // The webview itself never navigated.
  await expect(site).toBeVisible();
  expect(await readCalls(page, 'open_run')).toEqual([]);
});
