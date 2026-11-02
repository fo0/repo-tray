import { expect, test } from './support/test';

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
  await expect(
    page.getByRole('button', { name: 'Konto hinzufügen' }),
  ).toBeVisible();
});

test('the settings dialog traps Tab and Shift+Tab and closes with Escape', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Einstellungen',
    exact: true,
  });
  const first = dialog.getByRole('button', { name: 'Dialog schließen' });
  await expect(first).toBeFocused();
  // „Speichern“ waits for a change (aria-disabled) but stays focusable.
  const save = dialog.getByRole('button', { name: 'Speichern', exact: true });
  await page.keyboard.press('Shift+Tab');
  await expect(save).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  // The loop holds on every tab: „Speichern“ stays the last element.
  await dialog.getByRole('tab', { name: 'Updates', exact: true }).click();
  await save.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(save).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('closing settings with Escape returns focus to the settings button', async ({
  page,
}) => {
  await page.goto('/');
  const opener = page.getByRole('button', {
    name: 'Einstellungen',
    exact: true,
  });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {
    name: 'Einstellungen',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused({ timeout: 1000 });
});

test('a chained dialog returns focus to the opener of the first dialog', async ({
  page,
}) => {
  await page.goto('/');
  const opener = page.getByRole('button', {
    name: 'Einstellungen',
    exact: true,
  });
  await opener.focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  const connect = page.getByRole('dialog', {
    name: 'GitHub verbinden',
    exact: true,
  });
  await expect(connect).toBeVisible();
  await connect.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused({ timeout: 1000 });
});

test('every settings tab ends in the same footer: Abbrechen and Speichern', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Einstellungen',
    exact: true,
  });
  await expect(dialog.getByRole('tab')).toHaveText([
    'Konten',
    'App',
    'Updates',
  ]);
  for (const name of ['Konten', 'App', 'Updates']) {
    await dialog.getByRole('tab', { name, exact: true }).click();
    const actions = dialog.locator('.modal-actions').getByRole('button');
    await expect(actions).toHaveText(['Abbrechen', 'Speichern']);
    // Nothing staged yet: „Speichern“ says why it is off.
    await expect(actions.last()).toBeDisabled();
    await expect(actions.last()).toHaveAttribute('title', 'Keine Änderungen');
    await expect(
      dialog.getByRole('button', { name: 'Schließen', exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByLabel('Repositories filtern')).toHaveCount(0);
  }
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
