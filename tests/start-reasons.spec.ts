import { expect, test, type Page } from './support/test';
import { openLaunch, openPage, scenario, templateCard } from './support/demo';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
});

async function openRepo(page: Page, name: string) {
  const repo = page.getByRole('region', { name, exact: true });
  await repo.locator('.repository-toggle').click();
  return repo;
}

test('disabled repository starts name their one cause', async ({ page }) => {
  const kit = await openRepo(page, 'demo-dev/launch-kit-demo');
  const checks = kit.getByRole('button', {
    name: 'Checks starten…',
    exact: true,
  });
  await expect(checks).toBeDisabled();
  await expect(checks).toHaveAccessibleDescription('Kein manueller Start');
  const site = await openRepo(page, 'demo-dev/website-demo');
  const preview = site.getByRole('button', {
    name: 'Preview site starten…',
    exact: true,
  });
  await expect(preview).toBeDisabled();
  await expect(preview).toHaveAccessibleDescription(
    'Kein Schreibzugriff auf dieses Repository',
  );

  await scenario(page, 'offline');
  const desktop = kit.getByRole('button', {
    name: 'Desktop build starten…',
    exact: true,
  });
  await expect(desktop).toBeDisabled();
  // Offline, not the „Branch oder Tag und Eingaben wählen“ hint.
  await expect(desktop).toHaveAccessibleDescription(
    'Offline – Starts sind deaktiviert',
  );
  // The more basic cause wins: still no manual start.
  await expect(checks).toHaveAccessibleDescription('Kein manueller Start');
  await scenario(page, 'forbidden');
  await expect(desktop).toHaveAccessibleDescription(
    'Zugriff verweigert – Starts sind deaktiviert',
  );
});

test('the dialog start button names why it is off', async ({ page }) => {
  await scenario(page, 'offline');
  let dialog = await openLaunch(page);
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toHaveAccessibleDescription('Offline – Starts sind deaktiviert');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();

  await scenario(page, 'uncertain');
  dialog = await openLaunch(page);
  const start = dialog.getByRole('button', { name: 'Start simulieren' });
  await expect(start).toBeEnabled();
  await expect(start).toHaveAccessibleDescription('');
  await start.click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await expect(start).toBeDisabled();
  await expect(start).toHaveAccessibleDescription(
    'Startstatus ungeklärt – prüfe die Runs auf GitHub',
  );
});

test('a running start names itself on the locked favorite', async ({
  page,
}) => {
  await openPage(page, 'favorites');
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 2000);
  const card = templateCard(page, 'Windows build');
  const open = card.locator('.pin-start');
  await expect(open).toBeEnabled();
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByRole('button', { name: /Simuliert/ }),
  ).toHaveAccessibleDescription('Start läuft …');
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(open).toBeDisabled();
  await expect(open).toHaveAccessibleDescription('Start läuft …');
  await page.clock.runFor(400);
  await expect(open).toBeEnabled();
});
