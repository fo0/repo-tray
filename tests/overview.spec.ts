import { expect, test, type Page } from './support/test';
import {
  PAGE_TITLES,
  SECTION_TITLES,
  accountMenuButton,
  expectPage,
  maximizeButton,
  minimizeButton,
  openPage,
} from './support/demo';

type SectionName = keyof typeof SECTION_TITLES;
const SECTIONS = ['runs', 'favorites', 'repos'] as const;

const section = (page: Page, name: SectionName) =>
  page.getByRole('region', { name: SECTION_TITLES[name], exact: true });
const pageTitle = (page: Page, name: SectionName) =>
  page.getByRole('heading', { level: 2, name: PAGE_TITLES[name], exact: true });
const more = (page: Page) => page.getByRole('button', { name: /weitere/ });
const menuOf = (page: Page, name: string) =>
  page.getByRole('button', { name: `Aktionen für ${name}`, exact: true });

test.describe('demo overview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(maximizeButton(page, 'runs')).toBeVisible();
  });

  test('shows what runs, the favorites and the repositories, in that order', async ({
    page,
  }) => {
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.locator('.overview-section h2')).toHaveText([
      SECTION_TITLES.runs,
      SECTION_TITLES.favorites,
      SECTION_TITLES.repos,
    ]);
    // Each section is a region named by its heading, with a spoken count.
    await expect(section(page, 'runs')).toContainText('3 Runs');
    await expect(section(page, 'favorites')).toContainText('1 Favorit');
    await expect(section(page, 'repos')).toContainText('12 Repositories');
    const live = section(page, 'runs').getByRole('listitem');
    await expect(live).toHaveCount(3);
    // The repository leads in bold, the workflow and its number follow.
    await expect(live.first().locator('strong')).toHaveText('launch-kit-demo');
    await expect(live.first().locator('.live-workflow')).toHaveText(
      '· Checks#8402',
    );
    await expect(live.first()).toContainText('develop');
    // The demo polls every second: the rows are no live region.
    await expect(section(page, 'runs').locator('[aria-live]')).toHaveCount(0);
    await expect(section(page, 'runs').getByRole('status')).toHaveCount(0);
    // Only the repositories exceed their cap at the demo's sizes.
    await expect(more(page)).toHaveCount(1);
    await expect(
      section(page, 'repos').getByRole('button', { name: /weitere/ }),
    ).toHaveText('+2 weitere');
    for (const [name, key] of [
      ['runs', 2],
      ['favorites', 3],
      ['repos', 1],
    ] as const) {
      const button = maximizeButton(page, name);
      await expect(button).toHaveAttribute('data-maximize', name);
      await expect(button).toHaveAttribute('title', `Maximieren · Strg+${key}`);
      await expect(button).toHaveAttribute(
        'aria-keyshortcuts',
        `Control+${key}`,
      );
    }
  });

  for (const name of SECTIONS) {
    test(`maximizing ${name} focuses its page title; minimize and Esc return focus to the button`, async ({
      page,
    }) => {
      const maximize = await maximizeButton(page, name).boundingBox();
      await maximizeButton(page, name).click();
      await expectPage(page, name);
      await expect(pageTitle(page, name)).toBeFocused();
      await expect(
        page.getByRole('region', { name: PAGE_TITLES[name], exact: true }),
      ).toBeVisible();
      await expect(section(page, 'runs')).toHaveCount(0);
      // One toggle: the minimize button takes the maximize button's place
      // and size; no back button on the left.
      const minimize = minimizeButton(page, name);
      await expect(minimize).toHaveAttribute('title', 'Verkleinern · Esc');
      await expect(minimize).not.toHaveAttribute('data-maximize');
      expect(await minimize.boundingBox()).toEqual({
        ...maximize!,
        y: expect.any(Number),
      });
      await expect(page.locator('.page-back')).toHaveCount(0);
      // The page header reads like the section header, count included.
      await expect(
        page.locator('.page-header .section-count .sr-only'),
      ).toHaveText(
        { runs: '5 Runs', favorites: '1 Favorit', repos: '3 Repositories' }[
          name
        ],
      );
      await minimize.click();
      await expectPage(page, 'overview');
      await expect(maximizeButton(page, name)).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(pageTitle(page, name)).toBeFocused();
      await page.keyboard.press('Escape');
      await expectPage(page, 'overview');
      await expect(maximizeButton(page, name)).toBeFocused();
    });
  }

  test('Ctrl+1/2/3 open a page and the same key goes back to its section', async ({
    page,
  }) => {
    for (const [name, key] of [
      ['repos', 'Control+1'],
      ['runs', 'Control+2'],
      ['favorites', 'Control+3'],
    ] as const) {
      await page.keyboard.press(key);
      await expectPage(page, name);
      await expect(pageTitle(page, name)).toBeFocused();
      await page.keyboard.press(key);
      await expectPage(page, 'overview');
      // Opened with nothing focused: focus goes to the section's button.
      await expect(maximizeButton(page, name)).toBeFocused();
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    }
  });

  test('switching pages by key focuses the new page title', async ({
    page,
  }) => {
    await page.keyboard.press('Control+2');
    await expect(pageTitle(page, 'runs')).toBeFocused();
    // A reused title would keep focus silently; assistive tech announces
    // only a focus move.
    await page.evaluate(() =>
      document.addEventListener('focusin', (event) => {
        document.body.dataset.focused = String(
          (event.target as HTMLElement).textContent?.trim(),
        );
      }),
    );
    await page.keyboard.press('Control+3');
    await expect(pageTitle(page, 'favorites')).toBeFocused();
    await expect(page.locator('body')).toHaveAttribute(
      'data-focused',
      PAGE_TITLES.favorites,
    );
  });

  test('Escape closes an open menu on a page and stays there', async ({
    page,
  }) => {
    await openPage(page, 'runs');
    const trigger = accountMenuButton(page);
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Konto wechseln' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expectPage(page, 'runs');
    // The next Escape belongs to the page.
    await page.keyboard.press('Escape');
    await expectPage(page, 'overview');
  });

  test('Escape clears the search, leaves it, then leaves the page', async ({
    page,
  }) => {
    await openPage(page, 'repos');
    const search = page.getByLabel('Repositories durchsuchen');
    await search.fill('kit');
    await expect(page.locator('.repository-card')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(search).not.toBeFocused();
    await expectPage(page, 'repos');
    await page.keyboard.press('Escape');
    await expectPage(page, 'overview');
    await expect(maximizeButton(page, 'repos')).toBeFocused();
  });

  test('a running row opens the Verlauf with that run expanded, and back returns to the row', async ({
    page,
  }) => {
    const row = section(page, 'runs').getByRole('button', {
      name: /^example-org\/runner-tools-demo · Runner health #8403 · /,
    });
    await expect(row).toHaveAccessibleDescription('Im Verlauf anzeigen');
    await page.getByLabel('Übersicht durchsuchen').fill('runner');
    await row.click();
    await expectPage(page, 'runs');
    // Unfiltered and unsearched, like „Im Verlauf anzeigen“ in a notice.
    await expect(page.getByLabel('Verlauf durchsuchen')).toHaveValue('');
    await expect(
      page.getByRole('button', { name: 'Alle', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    const run = page.locator('article.run').filter({ hasText: '#8403' });
    await expect(run.getByRole('button', { expanded: true })).toBeFocused();
    await expect(page.locator('article.run .run-details')).toHaveCount(1);
    await minimizeButton(page, 'runs').click();
    await expect(row).toBeFocused();
  });

  test('the search filters every section and names a miss once', async ({
    page,
  }) => {
    const search = page.getByLabel('Übersicht durchsuchen');
    await search.fill('website');
    await expect(section(page, 'runs')).toContainText(
      'Keine passenden laufenden Runs.',
    );
    await expect(section(page, 'favorites')).toContainText(
      'Keine passenden Favoriten.',
    );
    await expect(page.locator('.repository-card')).toHaveCount(1);
    await search.fill('unmatched-query');
    await expect(page.locator('.overview-section')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Keine Treffer', exact: true }),
    ).toBeVisible();
    // The query stays with the panel when a page opens.
    await page.keyboard.press('Control+3');
    await expect(page.getByLabel('Favoriten durchsuchen')).toHaveValue(
      'unmatched-query',
    );
  });

  test('the tray picks its repositories: 10 on the overview, no way to add one', async ({
    page,
  }) => {
    const rows = page.locator('.repository-card');
    await expect(
      section(page, 'repos').locator('.repository-card'),
    ).toHaveCount(10);
    await expect(page.getByRole('button', { name: /Hinzufügen/ })).toHaveCount(
      0,
    );
    // Each account's oldest pushes stay out of the tray.
    for (const name of [
      'team-demo/sandbox-demo',
      'example-org/legacy-portal-demo',
    ])
      await expect(page.getByRole('region', { name, exact: true })).toHaveCount(
        0,
      );
    await openPage(page, 'repos');
    await expect(rows).toHaveCount(12);
    await expect(page.getByRole('button', { name: /Hinzufügen/ })).toHaveCount(
      0,
    );
    await menuOf(page, 'demo-dev/launch-kit-demo').click();
    await expect(page.getByRole('menuitem', { name: /Tray/ })).toHaveCount(0);
  });
});
