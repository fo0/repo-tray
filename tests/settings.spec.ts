import { expect, test } from '@playwright/test';

test('settings tabs support keyboard navigation and keep updates reachable at narrow widths', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  const accounts = page.getByRole('tab', { name: 'Konten', exact: true });
  await accounts.focus();
  await accounts.press('End');
  const updates = page.getByRole('tab', { name: 'Updates', exact: true });
  await expect(updates).toBeFocused();
  await expect(updates).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByText('Die Browser-Demo installiert keine App-Updates.'),
  ).toBeVisible();
  await expect(page.getByLabel('Repositories filtern')).toHaveCount(0);
  const dialog = page.getByRole('dialog');
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await updates.press('Home');
  await expect(accounts).toBeFocused();
  await expect(page.getByRole('button', { name: 'Einrichten' })).toBeVisible();
});

test('repository search preserves hidden selections and edits across settings tabs', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Repositories', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  await page.getByLabel('Repositories filtern').fill('sandbox');
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  await page.getByRole('checkbox').check();
  await page.getByRole('tab', { name: 'Updates', exact: true }).click();
  await page.getByRole('tab', { name: 'Repositories', exact: true }).click();
  await expect(page.getByRole('checkbox')).toBeChecked();
  await page.getByLabel('Repositories filtern').clear();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(4);
  await page.getByRole('button', { name: 'Auswahl speichern' }).click();
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Repositories', exact: true }).click();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(4);
});
