import { expect, test, type Locator, type Page } from './support/test';
import { openLaunch, openPage } from './support/demo';

const repoRow = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true });
const favorites = (page: Page) =>
  page.getByRole('region', { name: 'Favoriten', exact: true });
const tile = (page: Page, label: string) =>
  favorites(page).locator('.tile').filter({ hasText: label });
/** The strip's cells from left to right, by tone. */
const tones = (row: Locator) =>
  row
    .locator('.strip-cell')
    .evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute('data-tone')),
    );
const empty = (count: number) => Array<string>(count).fill('none');

/** Saves the launch dialog's default workflow on main as a favorite. */
async function saveFavorite(page: Page, label: string, quickStart = false) {
  const dialog = await openLaunch(page);
  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog.getByLabel('Name des Favoriten').fill(label);
  if (quickStart)
    await dialog
      .getByLabel('Schnellstart aktivieren', { exact: false })
      .check();
  await dialog
    .getByRole('button', { name: 'Favorit speichern', exact: true })
    .click();
  await expect(
    dialog.getByText(`„${label}“ als Favorit gespeichert.`, { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await openPage(page, 'overview');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
});

test.describe('run strip', () => {
  test('shows the last 8 runs of each repository, newest right, and says so in words', async ({
    page,
  }) => {
    const kit = repoRow(page, 'demo-dev/launch-kit-demo');
    const site = repoRow(page, 'demo-dev/website-demo');
    for (const row of [
      kit,
      site,
      repoRow(page, 'example-org/runner-tools-demo'),
    ])
      await expect(row.locator('.strip-cell')).toHaveCount(8);
    // The demo has fewer runs: empty cells first, by start time after them.
    expect(await tones(kit)).toEqual([...empty(5), 'ok', 'run', 'queue']);
    expect(await tones(site)).toEqual([...empty(7), 'fail']);
    const lefts = await kit
      .locator('.strip-cell')
      .evaluateAll((cells) =>
        cells.map((cell) => cell.getBoundingClientRect().left),
      );
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
    await expect(
      kit.getByRole('img', {
        name: 'Letzte 3 Runs: 1 erfolgreich, 1 läuft, 1 in Warteschlange',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      site.getByRole('img', {
        name: 'Letzter Run: fehlgeschlagen',
        exact: true,
      }),
    ).toBeVisible();
    // Colours come from the status tokens; empty cells from --none.
    await expect(kit.locator('.strip-cell[data-tone="ok"]')).toHaveCSS(
      'background-color',
      'rgb(74, 222, 128)',
    );
    await expect(site.locator('.strip-cell[data-tone="fail"]')).toHaveCSS(
      'background-color',
      'rgb(248, 113, 113)',
    );
    await expect(site.locator('.strip-cell').first()).toHaveCSS(
      'background-color',
      'rgb(44, 44, 51)',
    );
    // Colour is never alone: the row names its latest status with an icon.
    await expect(site.locator('.repository-status')).toHaveText(
      'Fehlgeschlagen',
    );
    await expect(site.locator('.repository-status svg')).toHaveCount(1);
    // Open runs come first: one running and one queued read „2 aktiv“ in the
    // running tone, not the queued run updated last.
    await expect(kit.locator('.repository-status')).toHaveText('2 aktiv');
    await expect(kit.locator('.repository-status')).toHaveAttribute(
      'data-tone',
      'run',
    );
    await expect(
      kit.getByRole('button', { name: /2 aktiv/, expanded: false }),
    ).toHaveClass(/repository-toggle/);
    await expect(site.locator('.repository-tag')).toHaveText('Nur Lesen');
    await expect(site).toHaveAttribute('data-repo-id', 'demo-personal-site');
    // Neither focusable nor a live region.
    await expect(
      page.locator(
        '.run-strip[tabindex], .run-strip [tabindex], .run-strip[aria-live]',
      ),
    ).toHaveCount(0);
  });

  test('a new run enters on the right', async ({ page }) => {
    await saveFavorite(page, 'Quick build', true);
    const kit = repoRow(page, 'demo-dev/launch-kit-demo');
    await tile(page, 'Quick build')
      .getByRole('button', {
        name: 'Favorit Quick build schnellstarten',
        exact: true,
      })
      .click();
    await expect(page.getByText(/Demo-Run #9001/)).toBeVisible();
    await expect(
      kit.getByRole('img', { name: /^Letzte 4 Runs: / }),
    ).toBeVisible();
    const after = await tones(kit);
    expect(after.slice(0, 7)).toEqual([...empty(4), 'ok', 'run', 'queue']);
    expect(['queue', 'run', 'ok']).toContain(after[7]);
  });

  test('the running cell pulses unless reduced motion is asked for', async ({
    page,
  }) => {
    const running = repoRow(page, 'demo-dev/launch-kit-demo').locator(
      '.strip-cell[data-tone="run"]',
    );
    await expect(running).toHaveCSS('animation-name', 'strip-pulse');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(running).toHaveCSS('animation-name', 'none');
  });
});

test.describe('favorite tiles', () => {
  test('the name, anywhere on the tile, and the round start open the stored configuration', async ({
    page,
  }) => {
    const windows = tile(page, 'Windows build');
    const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
    const expectStored = async () => {
      await expect(dialog.getByLabel('Version', { exact: true })).toHaveValue(
        '0.1.0',
      );
      await expect(dialog.getByLabel('Branch oder Tag')).toHaveValue('main');
      await dialog
        .getByRole('button', { name: 'Abbrechen', exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
    };
    await expect(windows).toContainText('launch-kit-demo');
    await expect(windows.locator('.branch-chip')).toHaveText('main');
    await windows
      .getByRole('button', { name: 'Favorit Windows build starten…' })
      .click();
    await expectStored();
    // The name's hit area covers the tile, e.g. its branch chip.
    const box = (await windows.boundingBox())!;
    await windows.click({ position: { x: 24, y: box.height - 20 } });
    await expectStored();
    // Without quick start the round start is a second pointer target for
    // the same dialog, hidden from assistive tech and the tab order.
    const start = windows.locator('.tile-start');
    await expect(start).toHaveAttribute('aria-hidden', 'true');
    await expect(start).toHaveAttribute('tabindex', '-1');
    await start.click();
    await expectStored();
  });

  test('the heart removes a tile and „Rückgängig“ brings it back', async ({
    page,
  }) => {
    await tile(page, 'Windows build')
      .getByRole('button', { name: 'Favorit Windows build entfernen' })
      .click();
    await expect(tile(page, 'Windows build')).toHaveCount(0);
    await expect(favorites(page)).toContainText('Noch keine Favoriten.');
    await page
      .getByRole('status')
      .filter({ hasText: 'Favorit „Windows build“ entfernt.' })
      .getByRole('button', { name: 'Rückgängig', exact: true })
      .click();
    await expect(tile(page, 'Windows build')).toHaveCount(1);
    await expect(
      tile(page, 'Windows build').getByRole('button', {
        name: 'Favorit Windows build entfernen',
      }),
    ).toBeVisible();
  });

  for (const width of [480, 360]) {
    test(`two tiles share a row at ${width}px; long names shorten and keep the full text in the tooltip`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 760 });
      const label = 'Nightly Windows x64 release build with symbols';
      await saveFavorite(page, label);
      const tiles = favorites(page).locator('.tile');
      await expect(tiles).toHaveCount(2);
      const layout = await tiles.evaluateAll((items) =>
        items.map((item) => {
          const r = item.getBoundingClientRect();
          const title = item.querySelector('.tile-title')!;
          return {
            top: r.top,
            left: r.left,
            right: r.right,
            width: r.width,
            height: r.height,
            clipped: title.scrollWidth > title.clientWidth,
            tooltip: item.querySelector('.tile-open')!.getAttribute('title'),
          };
        }),
      );
      const [first, second] = layout as [
        (typeof layout)[0],
        (typeof layout)[0],
      ];
      expect(second.top).toBe(first.top);
      expect(second.left).toBeGreaterThan(first.right);
      expect(second.width).toBeCloseTo(first.width, 0);
      // A long name stays on one line: the tile keeps its compact height.
      expect(second.height).toBe(first.height);
      expect(first.height).toBeLessThanOrEqual(110);
      expect(second.right).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      const long = layout.find((item) => item.tooltip?.startsWith(label))!;
      expect(long.clipped).toBe(true);
      expect(long.tooltip).toContain(
        `${label} · demo-dev/launch-kit-demo · main · `,
      );
    });
  }
});
