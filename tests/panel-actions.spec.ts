import { expect, test, type Page } from './support/test';
import {
  accountMenuButton,
  chooseAccount,
  expectPage,
  openLaunch,
  openPage,
  scenario,
  templateCard,
} from './support/demo';

// The footer shows clock times; a fixed zone keeps them deterministic.
test.use({ timezoneId: 'UTC' });

function notice(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text });
}

test('the footer refresh shows the new demo timestamp and confirms it', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-01T08:30:00Z'));
  await page.goto('/');
  const footer = page.locator('.app-footer').getByRole('button');
  // Synthetic fixture time until the first refresh. The name says what the
  // button does, the visible text what it shows.
  await expect(footer).toHaveText('Stand 09:45');
  await expect(footer).toHaveAccessibleName('Aktualisieren · Stand 09:45');
  await expect(footer).toHaveAccessibleDescription('Demo-Status aktualisieren');
  await footer.click();
  await expect(notice(page, 'Demo-Status aktualisiert.')).toBeVisible();
  await expect(footer).toHaveText('Stand 08:30');
  await expect(footer).toHaveAccessibleName('Aktualisieren · Stand 08:30');
  await expect(footer).toBeEnabled();
});

test('closing a notice removes only the notice', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Aktualisieren', exact: true })
    .click();
  const confirmation = notice(page, 'Demo-Status aktualisiert.');
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole('button', { name: 'Meldung schließen', exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expectPage(page, 'overview');
  await expect(
    page.getByRole('button', { name: 'Aktualisieren', exact: true }),
  ).toBeEnabled();
});

test('demo reset restores templates, scenario and account selection', async ({
  page,
}) => {
  await page.goto('/');
  const dialog = await openLaunch(page);
  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog.getByLabel('Name des Favoriten').fill('Reset me');
  await dialog
    .getByRole('button', { name: 'Favorit speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('„Reset me“ als Favorit gespeichert.', {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await scenario(page, 'offline');
  await chooseAccount(page, 'team-demo');
  const connection = page.getByRole('status', { name: 'Verbindungsstatus' });
  await expect(connection).toContainText('Offline');

  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: /^Demo zurücksetzen/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    notice(
      page,
      'Demo zurückgesetzt. Favoriten und Auswahl sind wieder im Ausgangszustand.',
    ),
  ).toBeVisible();
  await expect(connection).not.toContainText('Offline');
  await expect(accountMenuButton(page)).toHaveAccessibleName(
    'Konto: Alle Konten – Konto wechseln',
  );
  await expect(templateCard(page, 'Reset me')).toHaveCount(0);
  await expect(templateCard(page, 'Windows build')).toBeVisible();

  await page.reload();
  await openPage(page, 'favorites');
  await expect(templateCard(page, 'Windows build')).toBeVisible();
  await expect(templateCard(page, 'Reset me')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await expect(page.getByLabel('Demo-Szenario')).toHaveValue('normal');
});

test('demo reset is the explicit way to release a quarantined demo start', async ({
  page,
}) => {
  await page.goto('/');
  await scenario(page, 'uncertain');
  let dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  // Returning to the normal scenario alone must not release the quarantine.
  await scenario(page, 'normal');
  dialog = await openLaunch(page);
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Dialog schließen' }).click();
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: /^Demo zurücksetzen/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  dialog = await openLaunch(page);
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeEnabled();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toHaveCount(0);
});

test('„Im Verlauf anzeigen“ opens the accepted run in the full Verlauf', async ({
  page,
}) => {
  await page.goto('/');
  await openPage(page, 'runs');
  await page.getByRole('button', { name: /^Fehlgeschlagen/ }).click();
  await expect(
    page.getByRole('button', { name: /^Fehlgeschlagen/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  const dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Im Verlauf anzeigen', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectPage(page, 'runs');
  await expect(
    page.getByRole('button', { name: 'Alle', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Verlauf durchsuchen')).toHaveValue('');
  const run = page.getByRole('article').filter({ hasText: '#9001' });
  await expect(run.getByRole('button', { expanded: true })).toBeVisible();
  // The demo run has no link: both actions of its details stay disabled.
  for (const name of ['Auf GitHub öffnen', 'Link kopieren'])
    await expect(run.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(run).toContainText('Demo-Runs haben keinen GitHub-Link.');
});

test('a revealed run keeps its focus when it completes and moves to „Abgeschlossen“', async ({
  page,
}) => {
  await page.goto('/');
  const dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await dialog
    .getByRole('button', { name: 'Im Verlauf anzeigen', exact: true })
    .click();
  const group = (name: string) =>
    page.getByRole('group', { name, exact: true });
  const toggle = page
    .getByRole('article')
    .filter({ hasText: '#9001' })
    .getByRole('button', { expanded: true });
  await expect(group('Jetzt')).toContainText('#9001');
  await expect(toggle).toBeFocused();
  // The completed run is drawn anew in the other group; focus follows it.
  await expect(group('Abgeschlossen')).toContainText('#9001', {
    timeout: 7000,
  });
  await expect(toggle).toBeFocused();
});
