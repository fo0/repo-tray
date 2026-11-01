import { expect, test } from './support/test';
import { openDemoActivity, openConnection } from './support/demo';

test.beforeEach(async ({ page }) => {
  await openDemoActivity(page);
});

test('browser sign-in preview is explicitly paused and offers token entry', async ({
  page,
}) => {
  const dialog = await openConnection(page);
  await expect(
    dialog.getByRole('button', { name: /Mit GitHub anmelden/ }),
  ).toBeDisabled();
  await expect(
    dialog.getByText(
      /Browser-Anmeldung \/ GitHub App ist vorübergehend deaktiviert/,
    ),
  ).toBeVisible();
  await dialog
    .getByText('Alternativ: Token hinterlegen', { exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Token prüfen und verbinden' }),
  ).toBeDisabled();
  expect(page.context().pages()).toHaveLength(1);
});

test('cancelling a pending token preview invalidates its late confirmation', async ({
  page,
}) => {
  await page.clock.install();
  const dialog = await openConnection(page);
  await dialog
    .getByText('Alternativ: Token hinterlegen', { exact: true })
    .click();
  await dialog.getByLabel('Beispiel-Token').fill('demo-token');
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await dialog.getByRole('button', { name: 'Anmeldung abbrechen' }).click();
  await page.clock.fastForward(1000);
  await expect(
    dialog.getByRole('heading', { name: 'Anmeldung abgebrochen' }),
  ).toBeVisible();
  await expect(page.getByText(/Demo-Token geprüft und verworfen/)).toHaveCount(
    0,
  );
});

test('token preview clears its masked input and never persists user input', async ({
  page,
}) => {
  const dialog = await openConnection(page);
  await dialog
    .getByText('Alternativ: Token hinterlegen', { exact: true })
    .click();
  const input = dialog.getByLabel('Beispiel-Token');
  await input.fill('not-a-real-token-example');
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(input).toHaveValue('');
  await expect(dialog.getByRole('alert')).toContainText(
    'nur der Beispielwert „demo-token“',
  );
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage }),
  );
  expect(storage).not.toContain('not-a-real-token-example');
  await input.fill('demo-token');
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(/Demo-Token geprüft und verworfen/),
  ).toBeVisible();
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain('demo-token');
});

test('confirmation notice centers text, icon and close target at narrow and standard widths', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
  await dialog
    .getByText('Alternativ: Token hinterlegen', { exact: true })
    .click();
  await dialog.getByLabel('Beispiel-Token').fill('demo-token');
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(/Demo-Token geprüft und verworfen/),
  ).toBeVisible();
  for (const width of [480, 360]) {
    await page.setViewportSize({ width, height: 760 });
    const geometry = await page.locator('.notice-banner').evaluate((banner) => {
      const center = (node: Element) => {
        const r = node.getBoundingClientRect();
        return r.top + r.height / 2;
      };
      return {
        center: center(banner),
        children: ['span', 'svg', 'button'].map((selector) =>
          center(banner.querySelector(selector)!),
        ),
        height: banner.getBoundingClientRect().height,
      };
    });
    for (const center of geometry.children)
      expect(Math.abs(center - geometry.center)).toBeLessThanOrEqual(0.5);
    // At most two lines of 12px text (the metadata minimum) plus padding.
    expect(geometry.height).toBeLessThanOrEqual(55);
  }
});
