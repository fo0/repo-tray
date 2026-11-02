import { expect, test, type Page } from './support/test';
import { openLaunch, scenario, templateCard } from './support/demo';

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

test('plain success notices close after 3 s, hovered or focused alike', async ({
  page,
}) => {
  let notice = await refreshNotice(page);
  await page.clock.runFor(2500);
  await expect(notice).toBeVisible();
  await page.clock.runFor(600);
  await expect(notice).toHaveCount(0);

  notice = await refreshNotice(page);
  await notice.hover();
  await page.clock.runFor(3100);
  await expect(notice).toHaveCount(0);

  notice = await refreshNotice(page);
  await notice.getByRole('button', { name: 'Meldung schließen' }).focus();
  await page.clock.runFor(3100);
  await expect(notice).toHaveCount(0);
  // Focus is not dropped to the page with it.
  await expect(page.getByLabel('Übersicht durchsuchen')).toBeFocused();
});

/** Removes the demo favorite: a notice with „Rückgängig“ and its own timeout. */
async function undoNotice(page: Page) {
  await page
    .getByRole('region', { name: 'Favoriten', exact: true })
    .getByRole('button', {
      name: 'launch-kit-demo · Windows build aus Favoriten entfernen',
    })
    .click();
  const notice = page
    .getByRole('status')
    .filter({ hasText: 'Favorit „Windows build“ entfernt.' });
  await expect(notice).toBeVisible();
  return notice;
}

test('a notice with an action waits while hovered or focused, but never once the window hides', async ({
  page,
}) => {
  const notice = await undoNotice(page);
  await notice.hover();
  await page.clock.runFor(20_000);
  await expect(notice).toBeVisible();
  // The tray popup hides without a pointerleave: the window's blur ends
  // the hold, and the notice's own timeout runs out.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.runFor(8100);
  await expect(notice).toHaveCount(0);

  // A start result held by focus on „Im Verlauf anzeigen“ closes once the
  // document is hidden, after the default 3 s.
  const dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await page.keyboard.press('Escape');
  await page.clock.runFor(400);
  const result = page.getByRole('status').filter({ hasText: /Demo-Run #9001/ });
  await result
    .getByRole('button', { name: 'Im Verlauf anzeigen', exact: true })
    .focus();
  await page.clock.runFor(20_000);
  await expect(result).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(3100);
  await expect(result).toHaveCount(0);
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
    .getByRole('button', { name: 'Im Verlauf anzeigen' })
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
  await templateCard(page, 'Quick build')
    .getByRole('button', {
      name: 'launch-kit-demo · Quick build schnellstarten',
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
  await page.clock.runFor(2500);
  await expect(notice).toBeVisible();
  await page.clock.runFor(600);
  await expect(notice).toHaveCount(0);
});

test('closing a focused notice hands focus to the next notice, then to the page title', async ({
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
    page.getByRole('heading', { level: 2, name: 'Favoriten', exact: true }),
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
  // On the overview the search field is where focus lands.
  await expect(page.getByLabel('Übersicht durchsuchen')).toBeFocused();
});
