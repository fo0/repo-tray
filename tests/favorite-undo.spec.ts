import { expect, test } from '@playwright/test';
import { openDemoActivity, templateCard } from './support/demo';

test.beforeEach(async ({ page }) => {
  await openDemoActivity(page);
});

const removed = (label: string) =>
  ({ hasText: `Favorit „${label}“ entfernt.` }) as const;

test('„Rückgängig“ restores a removed favorite with its label, inputs and mode', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  const card = templateCard(page, 'Windows build');
  await card
    .getByRole('button', { name: 'Favorit Windows build entfernen' })
    .click();
  await expect(card).toHaveCount(0);
  const notice = page.getByRole('status').filter(removed('Windows build'));
  await notice.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(
    page.getByRole('status').filter({
      hasText: 'Favorit „Windows build“ wiederhergestellt.',
    }),
  ).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(card).toContainText('Mit Bestätigung');
  await card.locator('.pin-start').click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(dialog.getByLabel('Version')).toHaveValue('0.1.0');
  await expect(dialog.getByLabel('Branch oder Tag')).toHaveValue('main');
  await expect(dialog.getByLabel('Name des Favoriten')).toHaveValue(
    'Windows build',
  );
  // The same favorite again, not a copy: saving updates it.
  await expect(
    dialog.getByRole('button', {
      name: 'Favorit aktualisieren',
      includeHidden: true,
    }),
  ).toBeAttached();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await expect(card).toBeVisible();
});

test('the heart removes a renamed favorite with undo, and the removal is final after the timeout', async ({
  page,
}) => {
  await page.clock.install();
  await page.getByRole('button', { name: 'Repositories', exact: true }).click();
  const kit = page.getByRole('region', {
    name: 'demo-dev/launch-kit-demo',
    exact: true,
  });
  await kit.locator('.repository-toggle').click();
  const heart = kit.getByRole('button', {
    name: 'Desktop build aus Favoriten entfernen',
  });
  // The matching favorite carries another label than the workflow.
  await expect(heart).toHaveAttribute(
    'title',
    'Favorit „Windows build“ entfernen',
  );
  await heart.click();
  const notice = page.getByRole('status').filter(removed('Windows build'));
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  const pinned = page.getByRole('region', { name: 'Favoriten', exact: true });
  await expect(pinned).toContainText('Windows build');

  await heart.click();
  await expect(notice).toBeVisible();
  // Hovering holds the offer open.
  await notice.hover();
  await page.clock.runFor(9000);
  await expect(notice).toBeVisible();
  await page.getByRole('heading', { name: /^RepoTray/ }).hover();
  await page.clock.runFor(8100);
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(pinned).toHaveCount(0);
});
