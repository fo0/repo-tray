import { expect, test } from './support/test';
import {
  chooseAccount,
  openDemoActivity,
  openLaunch,
  openPage,
  scenario,
} from './support/demo';

test.beforeEach(async ({ page }) => {
  await openDemoActivity(page);
});

test('closing the launch dialog and cancelling connection create no runs', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await expect(dialog.getByLabel('Version')).toHaveValue('0.1.0');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await openPage(page, 'runs');
  await expect(page.getByText(/9001/)).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Konto hinzufügen' }).click();
  await expect(
    page.getByRole('button', {
      name: 'Mit GitHub anmelden',
    }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('double-click accepts exactly one simulated run and cannot submit twice', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).dblclick();
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await expect(dialog.getByText(/Demo-Run #9001/)).toBeVisible();
  await expect(page.getByText(/9002/)).toHaveCount(0);
});

test('offline and forbidden scenarios disable starts while showing cached activity', async ({
  page,
}) => {
  for (const value of ['offline', 'forbidden']) {
    await scenario(page, value);
    const dialog = await openLaunch(page);
    await expect(
      dialog.getByRole('button', { name: 'Start simulieren' }),
    ).toBeDisabled();
    await dialog
      .getByRole('button', { name: 'Abbrechen', exact: true })
      .click();
    await openPage(page, 'runs');
    await expect(
      page.getByText('demo-dev/launch-kit-demo', { exact: true }).first(),
    ).toBeVisible();
  }
});

test('unknown response remains quarantined when the form is reopened', async ({
  page,
}) => {
  await scenario(page, 'uncertain');
  let dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page
    .getByRole('button', { name: 'Workflow starten …', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Status prüfen', exact: true })
    .click();
  await expect(
    dialog.getByText(
      /Status geprüft\. GitHub hat den Start weiterhin nicht bestätigt/,
    ),
  ).toBeVisible();
});

test('a late start response cannot overwrite a newly chosen repository form', async ({
  page,
}) => {
  let dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await dialog.getByRole('button', { name: 'Dialog schließen' }).click();
  await chooseAccount(page, 'team-demo');
  await page
    .getByRole('button', { name: 'Workflow starten …', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(dialog.getByLabel('Repository')).toHaveValue('demo-team-tools');
  await expect(dialog.getByLabel('Attempts')).toHaveValue('3');
  await expect(dialog.getByLabel('Version')).toHaveCount(0);
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toHaveCount(0);
});

test('an offline status check never claims a successful refresh of an uncertain start', async ({
  page,
}) => {
  await scenario(page, 'uncertain');
  let dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await scenario(page, 'offline');
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Windows build' }) });
  await card
    .getByRole('button', {
      name: 'Favorit Windows build starten…',
      exact: true,
    })
    .click();
  dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await dialog
    .getByRole('button', { name: 'Status prüfen', exact: true })
    .click();
  await expect(
    dialog.getByText(
      'Status konnte nicht geprüft werden. Prüfe deine Verbindung und versuche es erneut. Starts bleiben gesperrt.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      /Status geprüft\. GitHub hat den Start weiterhin nicht bestätigt/,
    ),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
});
