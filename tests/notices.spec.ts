import { expect, test, type Page } from '@playwright/test';
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
