import { expect, test, type Page } from '@playwright/test';
import { openDemoActivity, openLaunch, templateCard } from './support/demo';

// The demo answers a start after 300 ms; a paused clock holds every start in
// flight until the test releases it with `runFor`.
async function holdStarts(page: Page) {
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 2000);
}

test.beforeEach(async ({ page }) => {
  await openDemoActivity(page);
});

const closers = {
  'the secondary button': (page: Page) =>
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Schließen', exact: true })
      .click(),
  Escape: (page: Page) => page.keyboard.press('Escape'),
  'the close icon': (page: Page) =>
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Dialog schließen' })
      .click(),
};

for (const [name, close] of Object.entries(closers)) {
  test(`closing the start dialog with ${name} keeps the start result in the banner`, async ({
    page,
  }) => {
    await holdStarts(page);
    const dialog = await openLaunch(page);
    await dialog.getByRole('button', { name: 'Start simulieren' }).click();
    await expect(
      dialog.getByRole('button', { name: /Simuliert/ }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Schließen', exact: true }),
    ).toHaveAccessibleDescription(/Der Start läuft weiter/);
    await close(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.clock.runFor(400);
    const banner = page
      .getByRole('status')
      .filter({ hasText: /Simulierter Start angenommen · Demo-Run #9001/ });
    await expect(banner).toBeVisible();
    await banner
      .getByRole('button', { name: 'In Aktivität anzeigen', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: /^Aktivität/ }),
    ).toHaveAttribute('aria-current', 'page');
    const run = page.getByRole('article').filter({ hasText: '#9001' });
    await expect(run.getByRole('button', { expanded: true })).toBeVisible();
    await expect(page.getByText(/9002/)).toHaveCount(0);
  });
}

test('a reopened start dialog keeps the running target locked until the start settles', async ({
  page,
}) => {
  await holdStarts(page);
  let dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page
    .locator('.workflow-heading')
    .getByRole('button', { name: 'Starten…', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  const start = dialog.getByRole('button', {
    name: /Simuliert|Start simulieren/,
  });
  await expect(start).toBeDisabled();
  await expect(start).toHaveText(/Simuliert/);
  await expect(dialog.getByLabel('Repository')).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Schließen', exact: true }),
  ).toBeVisible();
  await page.clock.runFor(400);
  // The result belongs to the closed dialog, so it lands in the banner and
  // never in this newer dialog.
  await expect(start).toHaveText(/Start simulieren/);
  await expect(start).toBeEnabled();
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByText(/Demo-Run #9001/)).toBeVisible();
  await expect(page.getByText(/9002/)).toHaveCount(0);
});

test('a quick start keeps its result when another dialog opens meanwhile', async ({
  page,
}) => {
  let dialog = await openLaunch(page);
  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog.getByLabel('Name des Favoriten').fill('Quick build');
  await dialog.getByLabel('Schnellstart aktivieren', { exact: false }).check();
  await dialog
    .getByRole('button', { name: 'Favorit speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('„Quick build“ als Favorit gespeichert.', {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await holdStarts(page);
  const card = templateCard(page, 'Quick build');
  await card.getByRole('button', { name: 'Schnellstart', exact: true }).click();
  await expect(
    card.getByRole('button', { name: 'Schnellstart', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Einstellungen' });
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  // Still running after the settings dialog closed: no second start possible.
  await expect(
    card.getByRole('button', { name: 'Schnellstart', exact: true }),
  ).toBeDisabled();
  await page.clock.runFor(400);
  await expect(page.getByText(/Quick build: .*Demo-Run #9001/)).toBeVisible();
  await expect(
    card.getByRole('button', { name: 'Schnellstart', exact: true }),
  ).toBeEnabled();
});

test('the start result scrolls into view and takes focus in a short panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 760 });
  const dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  const outcome = dialog
    .getByRole('status')
    .filter({ hasText: 'Simulierter Start angenommen' });
  await expect(outcome).toBeFocused();
  await expect(outcome).toBeInViewport();
});
