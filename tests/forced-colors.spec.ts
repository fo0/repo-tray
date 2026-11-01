import { expect, test, type Page } from './support/test';

const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Einstellungen', exact: true });

/** Demo settings with an unsaved repository selection, so its tab shows the dot. */
async function unsavedDot(page: Page) {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await dialog(page)
    .getByRole('tab', { name: 'Repositories', exact: true })
    .click();
  await dialog(page)
    .getByRole('checkbox', { name: /team-demo\/sandbox-demo/ })
    .check();
  const dot = dialog(page).getByRole('img', {
    name: 'Auswahl nicht gespeichert',
  });
  await expect(dot).toBeVisible();
  return dot;
}

/** Resolves a CSS system color in the page, e.g. `Canvas`. */
const systemColor = (page: Page, color: string) =>
  page.evaluate((color) => {
    const probe = document.createElement('span');
    probe.style.forcedColorAdjust = 'none';
    probe.style.color = color;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, color);

test('the unsaved tab dot follows forced colors instead of staying amber', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const dot = await unsavedDot(page);
  const style = await dot.evaluate((node) => {
    const computed = getComputedStyle(node);
    return {
      background: computed.backgroundColor,
      border: computed.borderTopColor,
      borderWidth: computed.borderTopWidth,
    };
  });
  // Hollow: the canvas fill with a text-colored ring, unlike the solid update dot.
  expect(style.background).toBe(await systemColor(page, 'Canvas'));
  expect(style.border).toBe(await systemColor(page, 'CanvasText'));
  expect(style.borderWidth).toBe('1px');
  expect(style.background).not.toBe(style.border);
});

test('without forced colors the unsaved tab dot keeps its warning color', async ({
  page,
}) => {
  const dot = await unsavedDot(page);
  // The --warning alias reads the status token --wait (#fbbf24).
  await expect(dot).toHaveCSS('background-color', 'rgb(251, 191, 36)');
});

test('run strip cells stay apart in forced colors', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  const cell = (repo: string, tone: string) =>
    page
      .getByRole('region', { name: repo, exact: true })
      .locator(`.strip-cell[data-tone="${tone}"]`)
      .first();
  const paint = (locator: ReturnType<typeof cell>) =>
    locator.evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        background: computed.backgroundColor,
        border: computed.borderTopColor,
        borderWidth: computed.borderTopWidth,
      };
    });
  const ok = await paint(cell('demo-dev/launch-kit-demo', 'ok'));
  const fail = await paint(cell('demo-dev/website-demo', 'fail'));
  const running = await paint(cell('demo-dev/launch-kit-demo', 'run'));
  const queued = await paint(cell('demo-dev/launch-kit-demo', 'queue'));
  const none = await paint(cell('demo-dev/website-demo', 'none'));
  // Success solid text colour, failure Mark, running Highlight; other runs a
  // text-coloured ring and empty cells a grey one on the canvas.
  expect(ok.background).toBe(await systemColor(page, 'CanvasText'));
  expect(fail.background).toBe(await systemColor(page, 'Mark'));
  expect(running.background).toBe(await systemColor(page, 'Highlight'));
  expect(queued.background).toBe(await systemColor(page, 'Canvas'));
  expect(queued.border).toBe(await systemColor(page, 'CanvasText'));
  expect(none.background).toBe(await systemColor(page, 'Canvas'));
  expect(none.border).toBe(await systemColor(page, 'GrayText'));
  expect(none.borderWidth).toBe('1px');
  const fills = [ok, fail, running, queued].map((cell) => cell.background);
  expect(new Set(fills).size).toBe(4);
  expect(none.border).not.toBe(queued.border);
});

test('favorite tiles keep their heart filled and their start outlined in forced colors', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  const tile = page
    .getByRole('region', { name: 'Favoriten', exact: true })
    .locator('.tile')
    .first();
  const heart = await tile
    .locator('.tile-heart svg')
    .evaluate((node) => getComputedStyle(node).fill);
  expect(heart).toBe(await systemColor(page, 'ButtonText'));
  await expect(tile.locator('.tile-start')).toHaveCSS(
    'border-top-color',
    await systemColor(page, 'ButtonText'),
  );
});
