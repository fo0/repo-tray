import { expect, test, type Page } from './support/test';
import { openPage } from './support/demo';

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

test('Verlauf status tiles and dots stay apart in forced colors', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  await openPage(page, 'runs');
  const run = (id: number) =>
    page.locator('article.run').filter({ hasText: `#${id}` });
  const paint = (id: number) =>
    run(id).evaluate((node) => {
      const tile = getComputedStyle(node.querySelector('.status-tile')!);
      const dot = getComputedStyle(
        node.querySelector('.run-status')!,
        '::before',
      );
      return {
        tile: tile.backgroundColor,
        tileBorder: tile.borderTopColor,
        dot: dot.backgroundColor,
        dotBorder: dot.borderTopColor,
      };
    });
  const running = await paint(8401);
  const waiting = await paint(8403);
  const failed = await paint(8404);
  const succeeded = await paint(8405);
  // Tints vanish: running fills Highlight and failure Mark, the rest keep a
  // text-coloured outline; dots like the run strip, success solid.
  expect(running.tile).toBe(await systemColor(page, 'Highlight'));
  expect(failed.tile).toBe(await systemColor(page, 'Mark'));
  expect(succeeded.tileBorder).toBe(await systemColor(page, 'CanvasText'));
  expect(waiting.tileBorder).toBe(await systemColor(page, 'CanvasText'));
  expect(running.dot).toBe(await systemColor(page, 'Highlight'));
  expect(failed.dot).toBe(await systemColor(page, 'Mark'));
  expect(succeeded.dot).toBe(await systemColor(page, 'CanvasText'));
  expect(waiting.dot).toBe(await systemColor(page, 'Canvas'));
  expect(waiting.dotBorder).toBe(await systemColor(page, 'CanvasText'));
  expect(
    new Set([running, failed, succeeded, waiting].map((item) => item.dot)).size,
  ).toBe(4);
  // The open history note's button keeps a frame where its fill vanishes.
  const info = page.getByRole('button', {
    name: 'Hinweis zum Verlauf',
    exact: true,
  });
  await expect(info).toHaveCSS('outline-style', 'none');
  await info.click();
  await expect(info).toHaveCSS('outline-style', 'solid');
});

test('favorite rows keep their heart filled and their start outlined in forced colors', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  const row = page
    .getByRole('region', { name: 'Favoriten', exact: true })
    .locator('.pin-row')
    .first();
  const heart = await row
    .locator('.pin-heart svg')
    .evaluate((node) => getComputedStyle(node).fill);
  expect(heart).toBe(await systemColor(page, 'ButtonText'));
  await expect(row.locator('.pin-start')).toHaveCSS(
    'border-top-color',
    await systemColor(page, 'ButtonText'),
  );
});

test('the chosen „Darstellung“ keeps its frame in forced colors on a light OS', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Einstellungen' });
  await dialog.getByRole('tab', { name: 'App', exact: true }).click();
  const choice = (name: string) =>
    dialog.locator('.theme-option').filter({
      has: page.getByRole('radio', { name, exact: true }),
    });
  await choice('Dunkel').getByRole('radio').check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const highlight = await systemColor(page, 'Highlight');
  await expect(choice('Dunkel')).toHaveCSS('border-top-color', highlight);
  await expect(choice('Hell')).not.toHaveCSS('border-top-color', highlight);
});
