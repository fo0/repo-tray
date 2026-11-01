import { expect, test, type Page } from './support/test';
import { openLaunch, scenario } from './support/demo';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
  await page.clock.install();
});

async function refreshNotice(page: Page) {
  await page
    .getByRole('button', { name: 'Aktualisieren', exact: true })
    .click();
  await page.clock.runFor(400);
  const notice = page
    .getByRole('status')
    .filter({ hasText: 'Demo-Status aktualisiert.' });
  await expect(notice).toBeVisible();
  return notice;
}

test('success notices close after a few seconds unless hovered or focused', async ({
  page,
}) => {
  let notice = await refreshNotice(page);
  await page.clock.runFor(5000);
  await expect(notice).toBeVisible();
  await page.clock.runFor(1200);
  await expect(notice).toHaveCount(0);

  notice = await refreshNotice(page);
  await notice.hover();
  await page.clock.runFor(10_000);
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Meldung schließen' }).focus();
  await page.getByRole('heading', { name: /^RepoTray/ }).hover();
  await page.clock.runFor(10_000);
  await expect(notice).toBeVisible();
  await page
    .getByRole('button', { name: 'Aktualisieren', exact: true })
    .focus();
  await page.clock.runFor(6200);
  await expect(notice).toHaveCount(0);
});

test('warnings stay until they are closed', async ({ page }) => {
  await scenario(page, 'uncertain');
  const dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await page.keyboard.press('Escape');
  await page.clock.runFor(400);
  const warning = page
    .getByRole('status')
    .filter({ hasText: /Desktop build: Demo: Antwort unterbrochen/ });
  await expect(warning).toBeVisible();
  await page.clock.runFor(30_000);
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Meldung schließen' }).click();
  await expect(warning).toHaveCount(0);
});

test('a notice with an action wraps below its text at 360px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 760 });
  const dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await page.keyboard.press('Escape');
  await page.clock.runFor(400);
  const notice = page.getByRole('status').filter({ hasText: /Demo-Run #9001/ });
  await expect(notice).toBeVisible();
  const box = (await notice.boundingBox())!;
  const text = (await notice.locator('span').first().boundingBox())!;
  const action = (await notice
    .getByRole('button', { name: 'In Aktivität anzeigen' })
    .boundingBox())!;
  const close = (await notice
    .getByRole('button', { name: 'Meldung schließen' })
    .boundingBox())!;
  // The action takes its own row under the text; close stays beside it.
  expect(action.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
  expect(close.y).toBeLessThan(text.y + text.height);
  expect(action.x + action.width).toBeLessThanOrEqual(box.x + box.width);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test('a notice that arrives behind a dialog waits there and times out only after the dialog closed', async ({
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
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Quick build' }) })
    .getByRole('button', {
      name: 'Favorit Quick build schnellstarten',
      exact: true,
    })
    .click();
  // The quick start settles while the settings dialog hides the panel.
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.clock.runFor(400);
  const hidden = page
    .locator('.notice-banner')
    .filter({ hasText: /Quick build: .*Demo-Run #9001/ });
  await expect(hidden).toBeAttached();
  await page.clock.runFor(30_000);
  await expect(hidden).toBeAttached();
  await page.getByRole('button', { name: 'Dialog schließen' }).click();
  const notice = page.getByRole('status').filter({ hasText: /Demo-Run #9001/ });
  await expect(notice).toBeVisible();
  // The full timeout starts once the dialog is gone.
  await page.getByRole('heading', { name: /^RepoTray/ }).hover();
  await page
    .getByRole('button', { name: 'Aktualisieren', exact: true })
    .focus();
  await page.clock.runFor(5000);
  await expect(notice).toBeVisible();
  await page.clock.runFor(1200);
  await expect(notice).toHaveCount(0);
});

test('closing a focused notice hands focus to the next notice, then to the view tab', async ({
  page,
}) => {
  await scenario(page, 'uncertain');
  const dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await page.keyboard.press('Escape');
  await page.clock.runFor(400);
  const warning = page
    .getByRole('status')
    .filter({ hasText: /Desktop build: Demo: Antwort unterbrochen/ });
  await expect(warning).toBeVisible();
  const refreshed = await refreshNotice(page);
  const close = (notice: typeof warning) =>
    notice.getByRole('button', { name: 'Meldung schließen' });

  await close(warning).focus();
  await page.keyboard.press('Enter');
  await expect(warning).toHaveCount(0);
  await expect(close(refreshed)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(refreshed).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Favoriten', exact: true }),
  ).toBeFocused();
});

test('F5 replaces a focused panel notice without dropping focus to the page', async ({
  page,
}) => {
  const notice = await refreshNotice(page);
  await notice.getByRole('button', { name: 'Meldung schließen' }).focus();
  await page.keyboard.press('F5');
  await page.clock.runFor(400);
  await expect(notice).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Repositories', exact: true }),
  ).toBeFocused();
});
