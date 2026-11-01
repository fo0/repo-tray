import { expect, test, type Page } from './support/test';
import { openPage } from './support/demo';

/** The demo picker with one repository in the tray and one outside it. */
async function pickerToggles(page: Page) {
  await page.goto('/');
  await openPage(page, 'picker');
  const toggle = (name: string) =>
    page.getByRole('button', { name, exact: true });
  const inTray = toggle('Im Tray: demo-dev/launch-kit-demo');
  const outside = toggle('Hinzufügen: team-demo/sandbox-demo');
  await expect(inTray).toBeVisible();
  await expect(outside).toBeVisible();
  return { inTray, outside };
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

test('a repository in the tray keeps its „Im Tray“ toggle visible in forced colors', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const { inTray, outside } = await pickerToggles(page);
  const paint = (locator: typeof inTray) =>
    locator.evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        background: computed.backgroundColor,
        color: computed.color,
        icon: getComputedStyle(node.querySelector('.pick-icon')!).color,
      };
    });
  const added = await paint(inTray);
  const addable = await paint(outside);
  // Drawn like a selected tab: the tinted row and grey border would vanish.
  expect(added.background).toBe(await systemColor(page, 'Highlight'));
  expect(added.color).toBe(await systemColor(page, 'HighlightText'));
  expect(added.icon).toBe(added.color);
  expect(addable.background).not.toBe(added.background);
});

test('without forced colors the „Im Tray“ toggle keeps the success check', async ({
  page,
}) => {
  const { inTray, outside } = await pickerToggles(page);
  // The check reads the status token --ok (#4ade80); adding reads the accent.
  await expect(inTray.locator('.pick-icon')).toHaveCSS(
    'color',
    'rgb(74, 222, 128)',
  );
  await expect(outside).toHaveCSS('color', 'rgb(181, 227, 122)');
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
