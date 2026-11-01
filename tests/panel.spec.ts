import { expect, test } from '@playwright/test';
import { openDemoActivity, openLaunch } from './support/demo';

test.beforeEach(async ({ page }) => {
  await openDemoActivity(page);
});

test('account and owner context, filters and search stay isolated', async ({
  page,
}) => {
  await expect(
    page.getByText('demo-dev/launch-kit-demo', { exact: true }).first(),
  ).toBeVisible();
  await page.getByLabel('Account auswählen').selectOption('demo-work');
  await expect(
    page.getByText('example-org/runner-tools-demo', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText('demo-dev/launch-kit-demo', { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Aktivität durchsuchen').fill('unmatched-query');
  await expect(
    page.getByRole('heading', { name: 'Hier ist gerade Ruhe' }),
  ).toBeVisible();
  await page.getByLabel('Account auswählen').selectOption('demo-personal');
  await page.getByRole('button', { name: /^Fehlgeschlagen/ }).click();
  await expect(
    page.getByText('demo-dev/website-demo', { exact: true }).first(),
  ).toBeVisible();
});

for (const width of [360, 480]) {
  test(`compact panel preserves readable text and click targets at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 });
    const geometry = await page.evaluate(() => {
      const header = document
        .querySelector('.app-header')!
        .getBoundingClientRect();
      const status = document
        .querySelector('.connection')!
        .getBoundingClientRect();
      const run = document
        .querySelector('.run-button')!
        .getBoundingClientRect();
      return {
        headerHeight: header.height,
        statusInside:
          status.top >= header.top && status.bottom <= header.bottom,
        rowHeight: run.height,
        runFont: parseFloat(
          getComputedStyle(document.querySelector('.run-name')!).fontSize,
        ),
        minIconTarget: Math.min(
          ...[...document.querySelectorAll('.icon-button')].map((button) =>
            Math.min(
              button.getBoundingClientRect().width,
              button.getBoundingClientRect().height,
            ),
          ),
        ),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(geometry.headerHeight).toBeLessThanOrEqual(56);
    expect(geometry.statusInside).toBe(true);
    expect(geometry.rowHeight).toBeLessThanOrEqual(79);
    expect(geometry.runFont).toBeGreaterThanOrEqual(12);
    expect(geometry.minIconTarget).toBeGreaterThanOrEqual(24);
    expect(geometry.overflow).toBe(false);
    const dialog = await openLaunch(page);
    const fieldHeight = await dialog
      .getByLabel('Version')
      .evaluate((input) => input.getBoundingClientRect().height);
    expect(fieldHeight).toBeGreaterThanOrEqual(34);
    await expect(
      dialog.getByRole('button', { name: 'Start simulieren' }),
    ).toBeVisible();
  });
}
