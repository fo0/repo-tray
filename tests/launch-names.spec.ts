import { expect, test, type Page } from './support/test';
import { openLaunch, scenario } from './support/demo';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
});

/** Accessible names of every visible „Starten…“ button except the generic one. */
function startNames(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter(
        (button) =>
          button.textContent?.trim() === 'Starten…' &&
          button.getBoundingClientRect().height > 0 &&
          !button.closest('.workflow-heading'),
      )
      .map((button) => button.getAttribute('aria-label') ?? ''),
  );
}

/** Whether `selector` shows the same glyph as the heart of the favorites tab. */
function showsHeart(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const heart = [...document.querySelectorAll('nav.tabs button')]
      .find((button) => button.textContent?.includes('Favoriten'))
      ?.querySelector('svg')?.innerHTML;
    const icon = document.querySelector(selector)?.querySelector('svg');
    return !!heart && icon?.innerHTML === heart;
  }, selector);
}

test('every „Starten…“ button names its target uniquely', async ({ page }) => {
  for (const toggle of await page.locator('.repository-toggle').all())
    await toggle.click();
  const repositories = await startNames(page);
  expect(repositories).toEqual(
    expect.arrayContaining([
      'Favorit Windows build starten…',
      'Desktop build starten…',
      'Runner health starten…',
    ]),
  );
  expect(new Set(repositories).size).toBe(repositories.length);
  expect(repositories).not.toContain('');
  // The row and its chip open the same dialog: one name, one control for
  // assistive tech.
  const pinned = page.getByRole('region', { name: 'Favoriten', exact: true });
  await expect(
    pinned.getByRole('button', {
      name: 'Favorit Windows build starten…',
      exact: true,
    }),
  ).toHaveClass(/pinned-copy/);
  await expect(pinned.getByRole('button', { name: /öffnen/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  const favorites = await startNames(page);
  expect(favorites).toEqual(['Favorit Windows build starten…']);
});

test('favorites use the heart icon in headings, empty state and save summary', async ({
  page,
}) => {
  expect(await showsHeart(page, '.pinned-heading h2')).toBe(true);
  const dialog = await openLaunch(page);
  expect(await showsHeart(page, '.save-pin summary')).toBe(true);
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page
    .getByRole('button', { name: 'Favorit Windows build entfernen' })
    .click();
  expect(await showsHeart(page, '.empty-pins')).toBe(true);
});

test('repository and workflow rows mark a locked start like favorites do', async ({
  page,
}) => {
  await scenario(page, 'uncertain');
  const dialog = await openLaunch(page);
  await dialog.getByLabel('Branch oder Tag').selectOption('develop');
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();

  // Favorites tab: the workflow list marks the workflow with its ref.
  await expect(
    page
      .locator('.workflow-item')
      .filter({ hasText: 'Desktop build' })
      .getByRole('img', { name: 'Startstatus ungeklärt · develop' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Repositories', exact: true }).click();
  const kit = page.getByRole('region', {
    name: 'demo-dev/launch-kit-demo',
    exact: true,
  });
  await expect(
    kit.getByRole('img', {
      name: 'Startstatus ungeklärt in diesem Repository',
    }),
  ).toBeVisible();
  await kit.locator('.repository-toggle').click();
  await expect(
    kit.getByRole('button', {
      name: 'Desktop build · main · Startstatus ungeklärt (develop)',
    }),
  ).toBeVisible();
  const tools = page.getByRole('region', {
    name: 'example-org/runner-tools-demo',
    exact: true,
  });
  await expect(tools.locator('.row-warning')).toHaveCount(0);
});
