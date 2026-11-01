import { expect, test } from './support/test';
import {
  chooseAccount,
  expectPage,
  openPage,
  settleTransitions,
} from './support/demo';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expectPage(page, 'overview');
});

test('repository disclosures show actions and both row and start button open the correct configuration', async ({
  page,
}) => {
  const repos = page.locator('.repository-card');
  await expect(repos).toHaveCount(3);
  await expect(repos.first()).toContainText('demo-dev/launch-kit-demo');
  const repo = repos.first();
  const toggle = repo.locator('.repository-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(
    repo.getByRole('button', { name: 'Desktop build starten…', exact: true }),
  ).toBeEnabled();
  await expect(
    repo.getByRole('button', { name: 'Checks starten…', exact: true }),
  ).toBeDisabled();
  await repo
    .getByRole('button', { name: 'Desktop build · main', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(dialog.getByLabel('Workflow', { exact: true })).toHaveValue(
    '101',
  );
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await repo
    .getByRole('button', { name: 'Desktop build starten…', exact: true })
    .click();
  await expect(dialog.getByLabel('Version', { exact: true })).toHaveValue(
    '0.1.0',
  );
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await toggle.click();
  await expect(
    repo.getByRole('button', { name: 'Desktop build starten…', exact: true }),
  ).toBeHidden();
});

test('expanded repositories stay open across page switches', async ({
  page,
}) => {
  const toggles = page.locator('.repository-toggle');
  await toggles.first().click();
  await toggles.nth(1).click();
  await toggles.nth(1).click();
  await openPage(page, 'runs');
  await openPage(page, 'favorites');
  await openPage(page, 'overview');
  await expect(toggles.first()).toHaveAttribute('aria-expanded', 'true');
  await expect(toggles.nth(1)).toHaveAttribute('aria-expanded', 'false');
  await expect(
    page.getByRole('button', { name: 'Desktop build starten…', exact: true }),
  ).toBeVisible();
});

test('heart favorites persist and remain scoped to their original account', async ({
  page,
}) => {
  const repo = page.getByRole('region', {
    name: 'example-org/runner-tools-demo',
    exact: true,
  });
  await repo.locator('.repository-toggle').click();
  await repo
    .getByRole('button', {
      name: 'Runner health als Favorit speichern',
      exact: true,
    })
    .click();
  await expect(
    repo.getByRole('button', {
      name: 'Runner health aus Favoriten entfernen',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  const pinned = page.getByRole('region', {
    name: 'Favoriten',
    exact: true,
  });
  await expect(
    pinned.getByRole('button', {
      name: 'Favorit Runner health starten…',
      exact: true,
    }),
  ).toBeVisible();
  const position = await page.evaluate(() => {
    const box = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect();
    const favorites = box('[aria-labelledby="section-favorites"]');
    return {
      search: box('.search-field').bottom,
      pinnedTop: favorites.top,
      pinnedBottom: favorites.bottom,
      repositories: box('.repository-list').top,
    };
  });
  expect(position.pinnedTop).toBeGreaterThanOrEqual(position.search);
  expect(position.pinnedBottom).toBeLessThanOrEqual(position.repositories);
  await page.reload();
  await repo.locator('.repository-toggle').click();
  await expect(
    repo.getByRole('button', {
      name: 'Runner health aus Favoriten entfernen',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await openPage(page, 'favorites');
  await expect(
    page.locator('.pin-card').filter({
      has: page.getByRole('heading', { name: 'Runner health', exact: true }),
    }),
  ).toContainText('team-demo');
  await chooseAccount(page, 'demo-dev');
  await expect(
    page.locator('.pin-card').filter({
      has: page.getByRole('heading', { name: 'Runner health', exact: true }),
    }),
  ).toHaveCount(0);
  await chooseAccount(page, 'team-demo');
  await openPage(page, 'overview');
  await repo.locator('.repository-toggle').click();
  await repo
    .getByRole('button', {
      name: 'Runner health aus Favoriten entfernen',
      exact: true,
    })
    .click();
  await expect(
    repo.getByRole('button', {
      name: 'Runner health als Favorit speichern',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(pinned.locator('.tile')).toHaveCount(0);
});

test('pinned favorites open the stored configuration and unpin from both views', async ({
  page,
}) => {
  const pinned = page.getByRole('region', {
    name: 'Favoriten',
    exact: true,
  });
  await pinned
    .getByRole('button', {
      name: 'Favorit Windows build starten…',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(dialog.getByLabel('Version', { exact: true })).toHaveValue(
    '0.1.0',
  );
  await expect(dialog.getByLabel('Branch oder Tag')).toHaveValue('main');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await pinned
    .getByRole('button', {
      name: 'Favorit Windows build entfernen',
      exact: true,
    })
    .click();
  // The section stays, with its maximize button and a hint instead of rows.
  await expect(pinned.locator('.tile')).toHaveCount(0);
  await expect(pinned).toContainText('Noch keine Favoriten.');
  await page.locator('.repository-toggle').first().click();
  await expect(
    page.getByRole('button', {
      name: 'Desktop build als Favorit speichern',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'false');
  await openPage(page, 'favorites');
  await expect(page.locator('.pin-card')).toHaveCount(0);
  await page.reload();
  await expect(pinned).toContainText('Noch keine Favoriten.');
  await expect(pinned.locator('.tile')).toHaveCount(0);
  await openPage(page, 'runs');
  await expect(page.getByText('#9001', { exact: true })).toHaveCount(0);
});

test('activity defaults to an interleaved history and retains a new run after it completes', async ({
  page,
}) => {
  await page
    .locator('.repository-card')
    .first()
    .locator('.repository-toggle')
    .click();
  await page
    .getByRole('button', { name: 'Desktop build starten…', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await dialog
    .getByRole('button', { name: 'Start simulieren', exact: true })
    .click();
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await openPage(page, 'runs');
  await expect(
    page.getByRole('button', { name: 'Alle', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('article.run')).toHaveCount(6);
  const run = page
    .locator('article.run')
    .filter({ has: page.getByText('#9001', { exact: true }) });
  await expect(run.locator('.run-status')).toHaveText('Erfolgreich', {
    timeout: 7000,
  });
  await run.locator('.run-button').click();
  const updated = await run.locator('.run-details').textContent();
  await page
    .getByRole('button', { name: 'Aktualisieren', exact: true })
    .click();
  await expect(
    page.getByText('Demo-Status aktualisiert.', { exact: true }),
  ).toBeVisible();
  expect(await run.locator('.run-details').textContent()).toBe(updated);
  await expect(
    page
      .locator('article.run')
      .filter({ has: page.getByText('#8404', { exact: true }) }),
  ).toContainText('Fehlgeschlagen');
});

for (const width of [360, 480]) {
  test(`repository controls fit at ${width}px and work with the keyboard`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 });
    const toggle = page.locator('.repository-toggle').first();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await settleTransitions(page); // the opened row's chevron turns
    const layout = await page.evaluate(() => {
      const box = (element: Element) => {
        const r = element.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          left: r.left,
          right: r.right,
        };
      };
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        repoHeight: box(document.querySelector('.repository-toggle')!).height,
        actionHeight: box(document.querySelector('.repository-action')!).height,
        tile: box(document.querySelector('.tile')!),
        // Every row: text, strip, „⋯“ menu, chevron last.
        strips: [...document.querySelectorAll('.repository-toggle')].map(
          (row) => ({
            row: box(row),
            copy: box(row.querySelector('.repository-copy')!),
            strip: box(row.querySelector('.run-strip')!),
            menu: box(row.parentElement!.querySelector('.repo-menu-button')!),
            chevron: box(row.querySelector('.repository-chevron')!),
          }),
        ),
        buttons: [
          ...document.querySelectorAll(
            '.repository-action button, .tile button',
          ),
        ]
          .filter((el) => el.getBoundingClientRect().height > 0)
          .map(box),
      };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.repoHeight).toBeLessThanOrEqual(50);
    expect(layout.actionHeight).toBeLessThanOrEqual(38);
    // Two tiles per row, each inside the panel.
    expect(layout.tile.width).toBeLessThan(width / 2);
    expect(layout.tile.width).toBeGreaterThanOrEqual(150);
    expect(layout.tile.right).toBeLessThanOrEqual(width);
    expect(layout.strips).toHaveLength(3);
    for (const { row, copy, strip, menu, chevron } of layout.strips) {
      expect(strip.width).toBeGreaterThan(0);
      expect(strip.left).toBeGreaterThanOrEqual(copy.right);
      expect(menu.left).toBeGreaterThanOrEqual(strip.right);
      expect(menu.right).toBeLessThanOrEqual(chevron.left);
      expect(chevron.right).toBeLessThanOrEqual(row.right);
      expect(row.right).toBeLessThanOrEqual(width);
    }
    for (const button of layout.buttons) {
      expect(button.width).toBeGreaterThanOrEqual(24);
      expect(button.height).toBeGreaterThanOrEqual(28);
      expect(button.left).toBeGreaterThanOrEqual(0);
      expect(button.right).toBeLessThanOrEqual(width);
    }
  });
}
