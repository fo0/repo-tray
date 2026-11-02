import { expect, test, type Locator, type Page } from './support/test';
import { openLaunch, openPage } from './support/demo';

const repoRow = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true });
const favorites = (page: Page) =>
  page.getByRole('region', { name: 'Favoriten', exact: true });
/** A favorite's row on the overview, by its exact label. */
const row = (page: Page, label: string) =>
  favorites(page)
    .locator('.pin-row')
    .filter({ has: page.locator('.pin-label', { hasText: label }) });
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
    await row(page, 'Quick build')
      .getByRole('button', {
        name: 'launch-kit-demo · Quick build schnellstarten',
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

test.describe('favorite rows', () => {
  test('the repository leads, the name anywhere on the row and the round start open the stored configuration', async ({
    page,
  }) => {
    const windows = row(page, 'Windows build');
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
    // The repository without its owner first and bold, the favorite's name
    // small and dimmed after it on the same line.
    const repo = windows.locator('.pin-repo');
    const label = windows.locator('.pin-label');
    await expect(repo).toHaveText('launch-kit-demo');
    await expect(label).toHaveText('Windows build');
    const style = await windows.evaluate((item) => {
      const [first, second] = [
        item.querySelector('.pin-repo')!,
        item.querySelector('.pin-label')!,
      ].map((node) => ({
        box: node.getBoundingClientRect(),
        css: getComputedStyle(node),
      }));
      return {
        firstIsRepo: item
          .querySelector('.pin-open')!
          .firstElementChild!.classList.contains('pin-repo'),
        oneLine: Math.abs(first!.box.bottom - second!.box.bottom) < 3,
        repoWeight: Number(first!.css.fontWeight),
        repoSize: parseFloat(first!.css.fontSize),
        labelSize: parseFloat(second!.css.fontSize),
      };
    });
    expect(style.firstIsRepo).toBe(true);
    expect(style.oneLine).toBe(true);
    expect(style.repoWeight).toBeGreaterThanOrEqual(600);
    expect(style.labelSize).toBeLessThan(style.repoSize);
    await expect(windows.locator('.branch-chip')).toHaveText('main');
    await windows
      .getByRole('button', {
        name: 'launch-kit-demo · Windows build starten…',
        exact: true,
      })
      .click();
    await expectStored();
    // The name's hit area covers the row, e.g. its branch chip.
    const box = (await windows.boundingBox())!;
    const chip = (await windows.locator('.branch-chip').boundingBox())!;
    await windows.click({
      position: { x: chip.x - box.x + chip.width / 2, y: box.height / 2 },
    });
    await expectStored();
    // Without quick start the round start is a second pointer target for
    // the same dialog, hidden from assistive tech and the tab order.
    const start = windows.locator('.pin-start');
    await expect(start).toHaveAttribute('aria-hidden', 'true');
    await expect(start).toHaveAttribute('tabindex', '-1');
    await start.click();
    await expectStored();
  });

  test('the heart removes a row and „Rückgängig“ brings it back', async ({
    page,
  }) => {
    const remove = row(page, 'Windows build').getByRole('button', {
      name: 'launch-kit-demo · Windows build aus Favoriten entfernen',
      exact: true,
    });
    await expect(remove).toHaveAttribute('title', 'Favorit entfernen');
    await remove.click();
    await expect(row(page, 'Windows build')).toHaveCount(0);
    await expect(favorites(page)).toContainText('Noch keine Favoriten.');
    await page
      .getByRole('status')
      .filter({ hasText: 'Favorit „Windows build“ entfernt.' })
      .getByRole('button', { name: 'Rückgängig', exact: true })
      .click();
    await expect(row(page, 'Windows build')).toHaveCount(1);
    await expect(remove).toBeVisible();
  });

  for (const width of [480, 360]) {
    test(`favorites are compact single-line rows at ${width}px; long names shorten and keep the full text in the tooltip`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 760 });
      const label = 'Nightly Windows x64 release build with symbols';
      await saveFavorite(page, label);
      const rows = favorites(page).locator('.pin-row');
      await expect(rows).toHaveCount(2);
      const layout = await rows.evaluateAll((items) =>
        items.map((item) => {
          const r = item.getBoundingClientRect();
          const repo = item.querySelector('.pin-repo')!;
          const name = item.querySelector('.pin-label')!;
          return {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            height: r.height,
            repoClipped: repo.scrollWidth > repo.clientWidth,
            nameClipped: name.scrollWidth > name.clientWidth,
            tooltip: item.querySelector('.pin-open')!.getAttribute('title'),
          };
        }),
      );
      const [first, second] = layout as [
        (typeof layout)[0],
        (typeof layout)[0],
      ];
      // One row each, stacked, full width, as low as a repository row.
      expect(second.top).toBeGreaterThanOrEqual(first.bottom);
      expect(second.left).toBe(first.left);
      expect(second.right).toBe(first.right);
      for (const item of layout) {
        expect(item.height).toBeGreaterThanOrEqual(32);
        expect(item.height).toBeLessThanOrEqual(36);
        expect(item.right).toBeLessThanOrEqual(width);
        // The repository stays whole; the favorite's name gives way.
        expect(item.repoClipped).toBe(false);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      const long = layout.find((item) => item.tooltip?.includes(label))!;
      expect(long.nameClipped).toBe(true);
      expect(long.tooltip).toContain(
        `demo-dev/launch-kit-demo · ${label} · main · `,
      );
    });
  }
});
