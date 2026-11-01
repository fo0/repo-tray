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
  await expect(dot).toHaveCSS('background-color', 'rgb(214, 183, 123)');
});
