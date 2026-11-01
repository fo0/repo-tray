import { expect, test, type Page } from '@playwright/test';
import { openDemoActivity, scenario, templateCard } from './support/demo';

test.beforeEach(async ({ page }) => {
  await openDemoActivity(page);
});

async function uncertainTemplate(page: Page, quickStart = false) {
  await page
    .getByLabel('Konto auswählen', { exact: true })
    .selectOption('demo-personal');
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  const card = templateCard(page, 'Windows build');
  if (quickStart) {
    await card.getByRole('button', { name: 'Starten…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
    await dialog.getByText('Als Favorit speichern', { exact: true }).click();
    await dialog
      .getByLabel('Schnellstart aktivieren', { exact: false })
      .check();
    await dialog
      .getByRole('button', { name: 'Favorit aktualisieren', exact: true })
      .click();
    await expect(
      dialog.getByText('„Windows build“ als Favorit gespeichert.', {
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Abbrechen', exact: true })
      .click();
  }
  await scenario(page, 'uncertain');
  await card
    .getByRole('button', {
      name: quickStart ? 'Favorit Windows build starten…' : 'Starten…',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await dialog
    .getByRole('button', { name: 'Start simulieren', exact: true })
    .click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  return card;
}

for (const width of [360, 480]) {
  test(`uncertain status uses the existing row with hover and keyboard help at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 });
    const card = await uncertainTemplate(page);
    const status = card.getByRole('button', {
      name: 'Startstatus ungeklärt',
      exact: true,
    });
    const tooltip = page.getByRole('tooltip');
    const height = (await card.boundingBox())!.height;
    expect(height).toBe(62);
    await expect(status).toBeVisible();
    expect((await status.boundingBox())!.height).toBeGreaterThanOrEqual(24);
    await expect(tooltip).toHaveCount(0);
    await status.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(
      'Ein erneuter Start für diesen Workflow und Branch bleibt gesperrt.',
    );
    const bounds = (await tooltip.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 12);
    expect(bounds.y).toBeGreaterThanOrEqual(12);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(748);
    expect((await card.boundingBox())!.height).toBe(height);
    await tooltip.hover();
    await expect(tooltip).toBeVisible();
    await page.getByRole('heading', { name: /^RepoTray/ }).hover();
    await expect(tooltip).toHaveCount(0);
    await status.focus();
    await expect(tooltip).toBeVisible();
    await expect(status).toHaveAccessibleDescription(
      /erneuter Start.*gesperrt/,
    );
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await expect(status).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      card.getByRole('button', { name: 'Starten…', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
    await expect(
      dialog.getByRole('button', { name: 'Start simulieren' }),
    ).toBeDisabled();
    await expect(
      dialog.getByText('Startstatus ungeklärt', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  });
}

test('touch can open and dismiss uncertain-start help without enabling quick start', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    viewport: { width: 360, height: 760 },
  });
  const page = await context.newPage();
  try {
    await page.goto('/');
    const card = await uncertainTemplate(page, true);
    const status = card.getByRole('button', {
      name: 'Startstatus ungeklärt',
      exact: true,
    });
    const tooltip = page.getByRole('tooltip');
    await expect(
      card.getByRole('button', { name: 'Schnellstart', exact: true }),
    ).toBeDisabled();
    await status.tap();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Schnellstart aktiviert');
    await expect(tooltip).toContainText('Zahnrad „Starten…“');
    await status.tap();
    await expect(tooltip).toHaveCount(0);
    await status.tap();
    await expect(tooltip).toBeVisible();
    await page.getByRole('heading', { name: /^RepoTray/ }).tap();
    await expect(tooltip).toHaveCount(0);
    await card
      .getByRole('button', { name: 'Favorit Windows build starten…' })
      .tap();
    await expect(
      page
        .getByRole('dialog')
        .getByRole('button', { name: 'Start simulieren' }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  } finally {
    await context.close();
  }
});
