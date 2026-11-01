import { expect, test, type Page } from './support/test';
import {
  chooseAccount,
  expectPage,
  openDemoActivity,
  openLaunch,
  openPage,
  scenario,
  templateCard,
} from './support/demo';

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
      .getByRole('button', { name: 'Im Verlauf anzeigen', exact: true })
      .click();
    await expectPage(page, 'runs');
    const run = page.getByRole('article').filter({ hasText: '#9001' });
    await expect(run.getByRole('button', { expanded: true })).toBeVisible();
    await expect(run.getByRole('button', { expanded: true })).toBeFocused();
    await expect(page.getByText(/9002/)).toHaveCount(0);
  });
}

test('closing the start dialog while its opener is locked moves focus to the overview’s search field', async ({
  page,
}) => {
  await openPage(page, 'overview');
  await holdStarts(page);
  // The pinned row opens the dialog and is disabled while its target starts.
  await page
    .getByRole('region', { name: 'Favoriten', exact: true })
    .getByRole('button', {
      name: 'Favorit Windows build starten…',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByRole('button', { name: /Simuliert/ }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Übersicht durchsuchen')).toBeFocused();
  await page.clock.runFor(400);
});

test('„Im Verlauf anzeigen“ in the dialog focuses the expanded run', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await dialog
    .getByRole('button', { name: 'Im Verlauf anzeigen', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const run = page.getByRole('article').filter({ hasText: '#9001' });
  await expect(run.getByRole('button', { expanded: true })).toBeFocused();
});

test('a reopened start dialog shows the result of the running start and stays locked', async ({
  page,
}) => {
  await holdStarts(page);
  let dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page
    .getByRole('button', { name: 'Workflow starten …', exact: true })
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
  // The reopened dialog watched the start: it shows the result read-only and
  // keeps the same lock as the dialog that started it.
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(/Demo-Run #9001/)).toBeVisible();
  await expect(start).toHaveText(/Start simulieren/);
  await expect(start).toBeDisabled();
  await page.clock.runFor(400);
  await expect(start).toBeDisabled();
  // Only a different target frees the start button again.
  await dialog.getByLabel('Branch oder Tag').selectOption('develop');
  await expect(start).toBeEnabled();
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByText(/Demo-Run #9001/)).toBeVisible();
  await expect(page.getByText(/9002/)).toHaveCount(0);
});

test('concurrent starts keep one banner each and both runs appear', async ({
  page,
}) => {
  await holdStarts(page);
  let dialog = await openLaunch(page);
  await dialog.getByLabel('Branch oder Tag').selectOption('develop');
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.clock.runFor(400);
  const banners = page
    .getByRole('status')
    .filter({ hasText: /Desktop build: Simulierter Start angenommen/ });
  await expect(banners).toHaveCount(2);
  await expect(banners.filter({ hasText: 'Demo-Run #9001' })).toBeVisible();
  await expect(banners.filter({ hasText: 'Demo-Run #9002' })).toBeVisible();
  await openPage(page, 'runs');
  await expect(page.getByText('#9001', { exact: true })).toBeVisible();
  await expect(page.getByText('#9002', { exact: true })).toBeVisible();
});

test('a later start neither clears nor replaces the warning of another target', async ({
  page,
}) => {
  await scenario(page, 'uncertain');
  let dialog = await openLaunch(page);
  await dialog.getByLabel('Branch oder Tag').selectOption('develop');
  await holdStarts(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.clock.runFor(400);
  const warning = page
    .getByRole('status')
    .filter({ hasText: /Desktop build: Demo: Antwort unterbrochen/ });
  await expect(warning).toBeVisible();
  await scenario(page, 'normal');
  dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(warning).toBeVisible();
  await page.clock.runFor(400);
  await expect(
    page.getByRole('status').filter({ hasText: /Demo-Run #9001/ }),
  ).toBeVisible();
  await expect(warning).toBeVisible();
});

test('a start that settles after an account switch offers no hidden run', async ({
  page,
}) => {
  await holdStarts(page);
  const dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await chooseAccount(page, 'team-demo');
  await page.clock.runFor(400);
  const banner = page.getByRole('status').filter({ hasText: /Demo-Run #9001/ });
  await expect(banner).toBeVisible();
  const show = banner.getByRole('button', { name: 'Im Verlauf anzeigen' });
  // The run belongs to demo-personal, which the Verlauf hides now.
  await expect(show).toHaveCount(0);
  await chooseAccount(page, 'demo-dev');
  await expect(show).toBeVisible();
  await show.click();
  const run = page.getByRole('article').filter({ hasText: '#9001' });
  await expect(run.getByRole('button', { expanded: true })).toBeVisible();
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
  await card
    .getByRole('button', {
      name: 'Favorit Quick build schnellstarten',
      exact: true,
    })
    .click();
  await expect(
    card.getByRole('button', {
      name: 'Favorit Quick build schnellstarten',
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Einstellungen' });
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  // Still running after the settings dialog closed: no second start possible.
  await expect(
    card.getByRole('button', {
      name: 'Favorit Quick build schnellstarten',
      exact: true,
    }),
  ).toBeDisabled();
  await page.clock.runFor(400);
  await expect(page.getByText(/Quick build: .*Demo-Run #9001/)).toBeVisible();
  await expect(
    card.getByRole('button', {
      name: 'Favorit Quick build schnellstarten',
      exact: true,
    }),
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
