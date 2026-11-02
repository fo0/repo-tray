import { expect, test, type Page } from './support/test';
import { openLaunch, openPage, scenario } from './support/demo';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
});

/**
 * Accessible names of every visible „Starten…“ button and of the round start
 * buttons of favorite rows; the generic „Workflow starten …“ of the
 * Favoriten page reads differently.
 */
function startNames(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter(
        (button) =>
          (button.textContent?.trim() === 'Starten…' ||
            button.classList.contains('pin-start')) &&
          button.getBoundingClientRect().height > 0,
      )
      .map((button) => button.getAttribute('aria-label') ?? ''),
  );
}

/** Whether `selector` shows exactly the glyph `heart`. */
function showsHeart(page: Page, selector: string, heart: string) {
  return page.evaluate(
    ([selector, heart]) =>
      document.querySelector(selector)?.querySelector('svg')?.innerHTML ===
      heart,
    [selector, heart] as const,
  );
}

test('every „Starten…“ button names its target uniquely', async ({ page }) => {
  for (const toggle of await page.locator('.repository-toggle').all())
    await toggle.click();
  const repositories = await startNames(page);
  expect(repositories).toEqual(
    expect.arrayContaining([
      'launch-kit-demo · Windows build starten…',
      'Desktop build starten…',
      'Runner health starten…',
    ]),
  );
  expect(new Set(repositories).size).toBe(repositories.length);
  expect(repositories).not.toContain('');
  // The row's name and its round start open the same dialog: one name, one
  // control for assistive tech.
  const pinned = page.getByRole('region', { name: 'Favoriten', exact: true });
  await expect(
    pinned.getByRole('button', {
      name: 'launch-kit-demo · Windows build starten…',
      exact: true,
    }),
  ).toHaveClass(/pin-open/);
  await expect(pinned.getByRole('button', { name: /öffnen/ })).toHaveCount(0);

  await openPage(page, 'favorites');
  const favorites = await startNames(page);
  expect(favorites).toEqual(['launch-kit-demo · Windows build starten…']);
});

test('favorites use the heart icon in headings, empty state and save summary', async ({
  page,
}) => {
  // The reference: the heart that removes a favorite on the overview.
  const heart = await page.locator('.pin-heart svg').innerHTML();
  expect(await showsHeart(page, '#section-favorites', heart)).toBe(true);
  const dialog = await openLaunch(page);
  expect(await showsHeart(page, '.save-pin summary', heart)).toBe(true);
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'launch-kit-demo · Windows build aus Favoriten entfernen',
    })
    .click();
  expect(await showsHeart(page, '.empty-pins', heart)).toBe(true);
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

  await openPage(page, 'overview');
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

test('two quick-start favorites name their quick start and their lock uniquely', async ({
  page,
}) => {
  for (const [label, ref] of [
    ['Develop quick', 'develop'],
    ['Main quick', 'main'],
  ] as const) {
    const dialog = await openLaunch(page);
    await dialog.getByLabel('Branch oder Tag').selectOption(ref);
    await dialog.getByText('Als Favorit speichern', { exact: true }).click();
    await dialog.getByLabel('Name des Favoriten').fill(label);
    await dialog
      .getByLabel('Schnellstart aktivieren', { exact: false })
      .check();
    await dialog
      .getByRole('button', { name: 'Favorit speichern', exact: true })
      .click();
    await expect(
      dialog.getByText(`„${label}“ als Favorit gespeichert.`, { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Abbrechen', exact: true })
      .click();
  }
  const quick = (label: string) =>
    page.getByRole('button', {
      name: `launch-kit-demo · ${label} schnellstarten`,
      exact: true,
    });
  await expect(quick('Develop quick')).toBeVisible();
  await expect(quick('Main quick')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Schnellstart', exact: true }),
  ).toHaveCount(0);

  // An uncertain quick start locks main: both favorites on it say which.
  await scenario(page, 'uncertain');
  await openPage(page, 'favorites');
  await quick('Main quick').click();
  const locked = (label: string) =>
    page.getByRole('button', {
      name: `Startstatus ungeklärt: launch-kit-demo · ${label}`,
      exact: true,
    });
  await expect(locked('Main quick')).toBeVisible();
  await expect(locked('Windows build')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Startstatus ungeklärt', exact: true }),
  ).toHaveCount(0);
  await openPage(page, 'overview');
  const pinned = page.getByRole('region', { name: 'Favoriten', exact: true });
  await expect(
    pinned.getByRole('img', {
      name: 'Startstatus ungeklärt: launch-kit-demo · Main quick',
    }),
  ).toBeVisible();
  await expect(
    pinned.getByRole('button', {
      name: 'launch-kit-demo · Develop quick schnellstarten',
    }),
  ).toBeEnabled();
});
