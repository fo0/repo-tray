import { expect, test, type Page } from './support/test';
import { expectPage, openPage, SECTION_TITLES } from './support/demo';
import {
  menuButton,
  notice,
  openNative,
  repoRow,
  selections,
} from './support/picker';
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
    await expect(item('Aus Tray entfernen')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(item('Letzten Run auf GitHub öffnen')).toBeFocused();
    // Escape closes the menu only, not the page or the search.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expectPage(page, 'repos');
    await page.keyboard.press('ArrowUp');
    await expect(item('Aus Tray entfernen')).toBeFocused();
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

  test('„Aus Tray entfernen“ removes the row, keeps focus nearby and offers undo', async ({
    page,
  }) => {
    await openNative(page);
    const row = repoRow(page, 'demo-dev/website-demo');
    await menuButton(page, 'demo-dev/website-demo').click();
    await page
      .getByRole('menuitem', { name: 'Aus Tray entfernen', exact: true })
      .click();
    await expect(row).toHaveCount(0);
    expect(await selections(page)).toEqual([
      ['demo-personal-kit', 'demo-team-tools'],
    ]);
    // Focus moves to the neighbouring row instead of dropping to the page.
    await expect(
      repoRow(page, 'demo-dev/launch-kit-demo').locator('.repository-toggle'),
    ).toBeFocused();
    await notice(page, 'website-demo aus dem Tray entfernt.')
      .getByRole('button', { name: 'Rückgängig' })
      .click();
    await expect(row).toBeVisible();
    await expect(
      notice(page, 'website-demo ist wieder im Tray.'),
    ).toBeVisible();
    expect((await selections(page)).at(-1)).toEqual([
      'demo-personal-kit',
      'demo-team-tools',
      'demo-personal-site',
    ]);
    await expect(
      page.getByRole('region', { name: SECTION_TITLES.repos, exact: true }),
    ).toContainText('2 Repositories');
  });
});

test('a menu whose button scrolls away closes and leaves focus on the button', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 560 });
  await page.goto('/');
  // An open repository makes the compact overview long enough to scroll
  // the last row's button out of view.
  await page.locator('.repository-toggle').first().click();
  const content = page.locator('.content');
  await content.evaluate((node) => (node.scrollTop = node.scrollHeight));
  const trigger = menuButton(page, 'demo-dev/website-demo');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', {
    name: 'Aktionen für demo-dev/website-demo',
  });
  await expect(menu.getByRole('menuitem').last()).toBeFocused();
  await content.evaluate((node) => (node.scrollTop = 0));
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Focus came back without scrolling the body back to the button.
  expect(await content.evaluate((node) => node.scrollTop)).toBe(0);
});
