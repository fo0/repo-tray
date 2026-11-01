import { expect, test, type Page } from './support/test';
import { openLaunch, openPage, templateCard } from './support/demo';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
});

/** The search field of the current view, whatever its label. */
const search = (page: Page) => page.locator('.search-field input');

test('clearing the search keeps focus in the search field', async ({
  page,
}) => {
  await search(page).fill('kit');
  await page
    .locator('.search-field')
    .getByRole('button', { name: 'Suche leeren' })
    .click();
  await expect(search(page)).toHaveValue('');
  await expect(search(page)).toBeFocused();

  // The empty state's „Suche leeren“ goes back to the field on every page.
  for (const name of ['overview', 'repos', 'runs', 'favorites'] as const) {
    await openPage(page, name);
    await search(page).fill('unmatched-query');
    await page
      .locator('.empty-state')
      .getByRole('button', { name: 'Suche leeren' })
      .click();
    await expect(search(page)).toHaveValue('');
    await expect(search(page)).toBeFocused();
  }
});

test('a quick start keeps focus on its button while it runs and after it settles', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog.getByLabel('Name des Favoriten').fill('Quick build');
  await dialog.getByLabel('Schnellstart aktivieren', { exact: false }).check();
  await dialog
    .getByRole('button', { name: 'Favorit speichern', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  // The demo answers after 300 ms; a paused clock holds the start in flight.
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 2000);
  const quick = templateCard(page, 'Quick build').getByRole('button', {
    name: 'Favorit Quick build schnellstarten',
  });
  await quick.focus();
  await page.keyboard.press('Enter');
  await expect(quick).toHaveAttribute('aria-disabled', 'true');
  await expect(quick).toBeFocused();
  // Another activation while it runs sends nothing.
  await page.keyboard.press('Enter');
  await page.clock.runFor(400);
  await expect(
    page.getByRole('status').filter({ hasText: /Quick build: .*#9001/ }),
  ).toBeVisible();
  await expect(page.getByText(/#9002/)).toHaveCount(0);
  await expect(quick).toBeEnabled();
  await expect(quick).toBeFocused();
});

test('the dialog start keeps focus while it runs, then hands it to the result', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 2000);
  const start = dialog.getByRole('button', { name: 'Start simulieren' });
  await start.focus();
  await page.keyboard.press('Enter');
  const running = dialog.getByRole('button', { name: /Simuliert/ });
  await expect(running).toHaveAttribute('aria-disabled', 'true');
  await expect(running).toBeFocused();
  await page.clock.runFor(400);
  await expect(
    dialog
      .getByRole('status')
      .filter({ hasText: 'Simulierter Start angenommen' }),
  ).toBeFocused();
});

test('closing the start dialog returns focus to a locked start button, which stays focusable', async ({
  page,
}) => {
  await openPage(page, 'favorites');
  // The demo answers after 300 ms; a paused clock holds the start in flight.
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 2000);
  const chip = templateCard(page, 'Windows build').getByRole('button', {
    name: 'Favorit Windows build starten…',
    exact: true,
  });
  await chip.click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(chip).toHaveAttribute('aria-disabled', 'true');
  await expect(chip).toHaveAccessibleDescription('Start läuft …');
  await page.clock.runFor(400);
  await expect(chip).toBeEnabled();
});
