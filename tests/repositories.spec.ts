import { expect, test } from './support/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Repositories', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
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

test('expanded repositories stay open across view switches', async ({
  page,
}) => {
  const toggles = page.locator('.repository-toggle');
  await toggles.first().click();
  await toggles.nth(1).click();
  await toggles.nth(1).click();
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await page.getByRole('button', { name: 'Repositories', exact: true }).click();
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
  const position = await page.evaluate(() => ({
    search: document.querySelector('.search-field')!.getBoundingClientRect()
      .bottom,
    pinnedTop: document
      .querySelector('.repository-favorites')!
      .getBoundingClientRect().top,
    pinnedBottom: document
      .querySelector('.repository-favorites')!
      .getBoundingClientRect().bottom,
    repositories: document
      .querySelector('.repository-list')!
      .getBoundingClientRect().top,
  }));
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
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await expect(
    page.locator('.pin-card').filter({
      has: page.getByRole('heading', { name: 'Runner health', exact: true }),
    }),
  ).toContainText('team-demo');
  await page
    .getByLabel('Konto auswählen', { exact: true })
    .selectOption('demo-personal');
  await expect(
    page.locator('.pin-card').filter({
      has: page.getByRole('heading', { name: 'Runner health', exact: true }),
    }),
  ).toHaveCount(0);
  await page
    .getByLabel('Konto auswählen', { exact: true })
    .selectOption('demo-work');
  await page.getByRole('button', { name: 'Repositories', exact: true }).click();
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
  await expect(pinned.locator('.pinned-action')).toHaveCount(0);
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
  await expect(pinned).toHaveCount(0);
  await page.locator('.repository-toggle').first().click();
  await expect(
    page.getByRole('button', {
      name: 'Desktop build als Favorit speichern',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await expect(page.locator('.pin-card')).toHaveCount(0);
  await page.reload();
  await expect(pinned).toHaveCount(0);
  await page.getByRole('button', { name: /^Aktivität/ }).click();
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
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  await expect(
    page.getByRole('button', { name: 'Alle', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('article.run')).toHaveCount(6);
  const run = page
    .locator('article.run')
    .filter({ has: page.getByText('#9001', { exact: true }) });
  await expect(run.locator('.status-label')).toHaveText('Erfolgreich', {
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
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      repoHeight: document
        .querySelector('.repository-toggle')!
        .getBoundingClientRect().height,
      actionHeight: document
        .querySelector('.repository-action')!
        .getBoundingClientRect().height,
      pinnedHeight: document
        .querySelector('.pinned-action')!
        .getBoundingClientRect().height,
      buttons: [...document.querySelectorAll('.repository-action button')]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            width: r.width,
            height: r.height,
            left: r.left,
            right: r.right,
          };
        }),
    }));
    expect(layout.overflow).toBe(false);
    expect(layout.repoHeight).toBeLessThanOrEqual(50);
    expect(layout.actionHeight).toBeLessThanOrEqual(38);
    expect(layout.pinnedHeight).toBeLessThanOrEqual(44);
    for (const button of layout.buttons) {
      expect(button.width).toBeGreaterThanOrEqual(24);
      expect(button.height).toBeGreaterThanOrEqual(28);
      expect(button.left).toBeGreaterThanOrEqual(0);
      expect(button.right).toBeLessThanOrEqual(width);
    }
  });
}
