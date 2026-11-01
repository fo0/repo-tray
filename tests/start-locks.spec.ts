import { expect, test, type Page } from './support/test';
import { openDemoActivity, openLaunch, templateCard } from './support/demo';

// The demo answers a start after 300 ms; a paused clock holds it in flight.
async function holdStarts(page: Page) {
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 2000);
}

/** Saves the launch dialog's default workflow on `ref` as a favorite. */
async function saveFavorite(page: Page, label: string, ref: string) {
  const dialog = await openLaunch(page);
  await dialog.getByLabel('Branch oder Tag').selectOption(ref);
  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog.getByLabel('Name des Favoriten').fill(label);
  await dialog
    .getByRole('button', { name: 'Favorit speichern', exact: true })
    .click();
  await expect(
    dialog.getByText(`„${label}“ als Favorit gespeichert.`, { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await openDemoActivity(page);
});

test('a running start locks only its own target in every list', async ({
  page,
}) => {
  await saveFavorite(page, 'Develop build', 'develop');
  await holdStarts(page);
  const dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();

  // Favorites tab: the main-branch favorite waits, the develop one does not.
  const main = templateCard(page, 'Windows build');
  const develop = templateCard(page, 'Develop build');
  await expect(main.locator('.pin-start')).toBeDisabled();
  await expect(develop.locator('.pin-start')).toBeEnabled();

  // Repositories tab: pinned favorites and workflow rows follow the target.
  await page.getByRole('button', { name: 'Repositories', exact: true }).click();
  const pinned = page.getByRole('region', { name: 'Favoriten', exact: true });
  const pinnedRow = (label: string) =>
    pinned.locator('.pinned-action').filter({ hasText: label });
  await expect(
    pinnedRow('Windows build').locator('.pinned-start'),
  ).toBeDisabled();
  await expect(
    pinnedRow('Develop build').locator('.pinned-start'),
  ).toBeEnabled();
  const kit = page.getByRole('region', {
    name: 'demo-dev/launch-kit-demo',
    exact: true,
  });
  await kit.locator('.repository-toggle').click();
  await expect(
    kit.getByRole('button', { name: 'Desktop build starten…', exact: true }),
  ).toBeDisabled();
  const tools = page.getByRole('region', {
    name: 'example-org/runner-tools-demo',
    exact: true,
  });
  await tools.locator('.repository-toggle').click();
  await expect(
    tools.getByRole('button', { name: 'Runner health starten…', exact: true }),
  ).toBeEnabled();
  await expect(
    tools.getByRole('button', { name: 'Runner health als Favorit speichern' }),
  ).toBeEnabled();

  await page.clock.runFor(400);
  await expect(
    pinnedRow('Windows build').locator('.pinned-start'),
  ).toBeEnabled();
  await expect(
    kit.getByRole('button', { name: 'Desktop build starten…', exact: true }),
  ).toBeEnabled();
});
