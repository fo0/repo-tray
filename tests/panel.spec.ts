import { expect, test } from './support/test';
import { chooseAccount, openDemoActivity, openLaunch } from './support/demo';

test.beforeEach(async ({ page }) => {
  await openDemoActivity(page);
});

test('account and owner context, filters and search stay isolated', async ({
  page,
}) => {
  // A row shows the repository's name; its accessible name leads with it,
  // owner included.
  const rowsOf = (repo: string) =>
    page.getByRole('button', { name: new RegExp(`^${repo} · `) });
  await expect(rowsOf('demo-dev/launch-kit-demo').first()).toBeVisible();
  await chooseAccount(page, 'team-demo');
  await expect(rowsOf('example-org/runner-tools-demo').first()).toBeVisible();
  await expect(rowsOf('demo-dev/launch-kit-demo')).toHaveCount(0);
  const search = page.getByLabel('Verlauf durchsuchen');
  await search.fill('unmatched-query');
  await expect(
    page.getByRole('heading', { name: 'Keine passenden Runs' }),
  ).toBeVisible();
  await page
    .locator('.empty-state')
    .getByRole('button', { name: 'Suche leeren', exact: true })
    .click();
  await expect(search).toHaveValue('');
  await expect(rowsOf('example-org/runner-tools-demo').first()).toBeVisible();
  await chooseAccount(page, 'demo-dev');
  await page.getByRole('button', { name: /^Fehlgeschlagen/ }).click();
  await expect(rowsOf('demo-dev/website-demo').first()).toBeVisible();
});

for (const width of [360, 480]) {
  test(`compact panel preserves readable text and click targets at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 });
    const geometry = await page.evaluate(() => {
      const header = document
        .querySelector('.app-bar')!
        .getBoundingClientRect();
      // The connection status moved from the header into the footer.
      const footer = document
        .querySelector('.app-footer')!
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
          status.top >= footer.top &&
          status.bottom <= footer.bottom &&
          status.right <= footer.right,
        rowHeight: run.height,
        runFont: parseFloat(
          getComputedStyle(document.querySelector('.run-repo')!).fontSize,
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
