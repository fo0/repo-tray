import { expect, test, type Page } from '@playwright/test';

const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Einstellungen', exact: true });
const confirm = (page: Page) =>
  dialog(page).getByRole('group', { name: 'Änderungen verwerfen?' });
const sandbox = (page: Page) =>
  dialog(page).getByRole('checkbox', { name: /team-demo\/sandbox-demo/ });

/** Opens settings on the repository tab and ticks the unselected demo repository. */
async function editSelection(page: Page) {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await dialog(page)
    .getByRole('tab', { name: 'Repositories', exact: true })
    .click();
  await sandbox(page).check();
  await expect(dialog(page).getByText('noch nicht gespeichert')).toBeVisible();
}

async function reopenRepositories(page: Page) {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await dialog(page)
    .getByRole('tab', { name: 'Repositories', exact: true })
    .click();
}

test('Escape with an unsaved selection asks first; Escape again keeps editing', async ({
  page,
}) => {
  await editSelection(page);
  await page.keyboard.press('Escape');
  await expect(confirm(page)).toContainText(
    'Deine geänderte Repository-Auswahl ist noch nicht gespeichert.',
  );
  await expect(
    confirm(page).getByRole('button', { name: 'Weiter bearbeiten' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm(page)).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
  await expect(sandbox(page)).toBeChecked();
  await expect(
    dialog(page).getByRole('button', { name: 'Auswahl speichern' }),
  ).toBeFocused();
  // „Verwerfen“ closes and drops the edit; the saved selection is unchanged.
  await dialog(page)
    .getByRole('button', { name: 'Schließen', exact: true })
    .click();
  await confirm(page)
    .getByRole('button', { name: 'Verwerfen', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await reopenRepositories(page);
  await expect(sandbox(page)).not.toBeChecked();
  await expect(dialog(page).getByText('noch nicht gespeichert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
});

test('edits survive tab switches, the tab shows them and „Weiter bearbeiten“ leads back to saving', async ({
  page,
}) => {
  await editSelection(page);
  // The marker is part of the tab's name, like „Update verfügbar“.
  const repositories = dialog(page).getByRole('tab', {
    name: /^Repositories/,
  });
  await expect(repositories).toHaveAccessibleName(
    'Repositories Auswahl nicht gespeichert',
  );
  await dialog(page).getByRole('tab', { name: 'Updates', exact: true }).click();
  // Every tab closes with „Schließen“: nothing else is pending there.
  await expect(
    dialog(page).getByRole('button', { name: 'Abbrechen', exact: true }),
  ).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Dialog schließen' }).click();
  await confirm(page)
    .getByRole('button', { name: 'Weiter bearbeiten', exact: true })
    .click();
  await expect(repositories).toHaveAttribute('aria-selected', 'true');
  const save = dialog(page).getByRole('button', { name: 'Auswahl speichern' });
  await expect(save).toBeFocused();
  await save.click();
  await expect(dialog(page)).toHaveCount(0);
  await reopenRepositories(page);
  await expect(sandbox(page)).toBeChecked();
  await expect(repositories).toHaveAccessibleName('Repositories');
});

test('undoing an edit needs no question, and adding an account asks before it replaces the dialog', async ({
  page,
}) => {
  await editSelection(page);
  await sandbox(page).uncheck();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await reopenRepositories(page);
  await sandbox(page).check();
  await dialog(page).getByRole('tab', { name: 'Konten', exact: true }).click();
  await dialog(page)
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'GitHub verbinden' }),
  ).toHaveCount(0);
  await confirm(page)
    .getByRole('button', { name: 'Verwerfen', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'GitHub verbinden' }),
  ).toBeVisible();
});
