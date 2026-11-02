import { expect, test, type Page } from './support/test';
import { expectPage, openPage } from './support/demo';
import { menuButton, notice, openNative, repoRow } from './support/nativeRepos';
import { readCalls } from './support/tauriMock';

const KIT_RUN = 'https://github.com/demo-dev/launch-kit-demo/actions/runs/8402';

/** Replaces the clipboard with a recorder. */
async function recordClipboard(page: Page) {
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.assign(window, { __copied: copied });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
  });
}
const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

test.describe('native repository menu', () => {
  test('the „⋯“ menu works with the keyboard and opens the latest run', async ({
    page,
  }) => {
    await openNative(page);
    // On a page with a way back, so a doubly handled Escape would show.
    await openPage(page, 'repos');
    const trigger = menuButton(page, 'demo-dev/launch-kit-demo');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', {
      name: 'Aktionen für demo-dev/launch-kit-demo',
    });
    const item = (name: string) => menu.getByRole('menuitem', { name });
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(item('Letzten Run auf GitHub öffnen')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item('Link kopieren')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item('Letzten Run auf GitHub öffnen')).toBeFocused();
    // The menu only opens and copies; the tray picks its repositories itself.
    await expect(menu.getByRole('menuitem')).toHaveCount(2);
    // Escape closes the menu only, not the page or the search.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expectPage(page, 'repos');
    await page.keyboard.press('ArrowUp');
    await expect(item('Link kopieren')).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect
      .poll(() => readCalls(page, 'open_run'))
      .toEqual([{ cmd: 'open_run', args: { url: KIT_RUN } }]);
    await expect(trigger).toBeFocused();
  });

  test('„Link kopieren“ copies the repository page; a right click opens the same menu', async ({
    page,
  }) => {
    await recordClipboard(page);
    await openNative(page);
    await repoRow(page, 'demo-dev/website-demo')
      .locator('.repository-copy')
      .click({ button: 'right' });
    const menu = page.getByRole('menu', {
      name: 'Aktionen für demo-dev/website-demo',
    });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Link kopieren' }).click();
    await expect(notice(page, 'Link kopiert.')).toBeVisible();
    expect(await copied(page)).toEqual([
      'https://github.com/demo-dev/website-demo',
    ]);
  });
});

test('a menu whose button scrolls away closes and leaves focus on the button', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 560 });
  // Enough rows to scroll: the last one shown on the overview is bulk-07.
  await openNative(page, { more: 8 });
  const content = page.locator('.content');
  await content.evaluate((node) => (node.scrollTop = node.scrollHeight));
  const trigger = menuButton(page, 'demo-dev/bulk-07-demo');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', {
    name: 'Aktionen für demo-dev/bulk-07-demo',
  });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await content.evaluate((node) => (node.scrollTop = 0));
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Focus came back without scrolling the body back to the button.
  expect(await content.evaluate((node) => node.scrollTop)).toBe(0);
});
