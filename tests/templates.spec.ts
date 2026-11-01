import { expect, test, type Locator } from './support/test';
import {
  chooseAccount,
  openDemoActivity,
  openLaunch,
  scenario,
  templateCard,
} from './support/demo';

test.beforeEach(async ({ page }) => {
  await openDemoActivity(page);
});

/** The favorite card's button that opens it in the start dialog. */
const opener = (card: Locator, label: string) =>
  card.getByRole('button', { name: `Favorit ${label} starten…`, exact: true });

test('pins persist and keep quick launch disabled until explicitly enabled', async ({
  page,
}) => {
  let dialog = await openLaunch(page);
  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog.getByLabel('Name des Favoriten').fill('My saved build');
  await dialog
    .getByRole('button', { name: 'Favorit speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('„My saved build“ als Favorit gespeichert.', {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'My saved build' }) });
  await expect(
    card.getByText('Mit Bestätigung', { exact: false }),
  ).toBeVisible();
  await opener(card, 'My saved build').click();
  dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(dialog.getByLabel('Branch oder Tag')).toHaveValue('main');
  await expect(dialog.getByLabel('Version')).toHaveValue('0.1.0');
});

test('explicitly enabled quick launch dispatches from a saved template', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog.getByLabel('Name des Favoriten').fill('Quick build');
  await dialog.getByLabel('Schnellstart aktivieren', { exact: false }).check();
  await dialog
    .getByRole('button', { name: 'Favorit speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('„Quick build“ als Favorit gespeichert.', {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Quick build' }) });
  await card
    .getByRole('button', {
      name: 'Favorit Quick build schnellstarten',
      exact: true,
    })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/Demo-Run #9001/)).toBeVisible();
});

test('Enter in a template name saves it without starting a run', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog.getByLabel('Name des Favoriten').fill('Saved with Enter');
  await dialog.getByLabel('Name des Favoriten').press('Enter');
  await expect(
    dialog.getByText('„Saved with Enter“ als Favorit gespeichert.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  await expect(page.getByText(/9001/)).toHaveCount(0);
});

test('saving is blocked during dispatch and the result still appears', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog
    .getByLabel('Name des Favoriten')
    .fill('Do not save during dispatch');
  const blocked = await dialog.evaluate(async (node) => {
    const buttons = [...node.querySelectorAll('button')];
    const start = buttons.find((button) =>
      button.textContent?.includes('Start simulieren'),
    )!;
    const save = buttons.find((button) =>
      button.textContent?.includes('Favorit speichern'),
    )!;
    start.click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const disabled = save.disabled;
    save.click();
    return disabled;
  });
  expect(blocked).toBe(true);
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(/als Favorit gespeichert\./)).toHaveCount(0);
});

test('offline still allows opening and editing a saved template', async ({
  page,
}) => {
  await scenario(page, 'offline');
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Windows build' }) });
  await expect(opener(card, 'Windows build')).toBeEnabled();
  await opener(card, 'Windows build').click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(dialog.getByLabel('Version')).toBeEnabled();
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
});

test('an empty launch search hides empty groups and offers a clear action', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await page
    .getByLabel('Favoriten und Workflows durchsuchen')
    .fill('unmatched-query');
  const state = page.locator('.empty-state').filter({
    has: page.getByRole('heading', {
      name: 'Keine passenden Favoriten oder Workflows',
    }),
  });
  await expect(state).toBeVisible();
  await expect(page.locator('.repo-group')).toHaveCount(0);
  await state.getByRole('button', { name: 'Suche leeren' }).click();
  await expect(
    page.getByRole('heading', { name: 'Windows build' }),
  ).toBeVisible();
});

test('copying an existing template keeps the original and its values', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  const original = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Windows build' }) });
  await opener(original, 'Windows build').click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await dialog.getByLabel('Branch oder Tag').selectOption('develop');
  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog.getByLabel('Name des Favoriten').fill('Develop copy');
  await expect(
    dialog.getByRole('button', { name: 'Favorit aktualisieren', exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Als neuen Favoriten speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('„Develop copy“ als Favorit gespeichert.', {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Develop copy', exact: true }),
  ).toBeVisible();
  await opener(original, 'Windows build').click();
  await expect(
    page.getByRole('dialog').getByLabel('Branch oder Tag'),
  ).toHaveValue('main');
});

test('compact saved templates keep quick-start configuration and removal reachable', async ({
  page,
}) => {
  const dialog = await openLaunch(page);
  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog.getByLabel('Name des Favoriten').fill('Compact quick build');
  await dialog.getByLabel('Schnellstart aktivieren', { exact: false }).check();
  await dialog
    .getByRole('button', { name: 'Favorit speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('„Compact quick build“ als Favorit gespeichert.', {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const card = templateCard(page, 'Compact quick build');
  await expect(
    card.getByText('Schnellstart aktiv', { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole('button', {
      name: 'Favorit Compact quick build schnellstarten',
      exact: true,
    }),
  ).toBeVisible();
  await opener(card, 'Compact quick build').click();
  await expect(page.getByRole('dialog').getByLabel('Version')).toHaveValue(
    '0.1.0',
  );
  await expect(page.getByText(/9001/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await card
    .getByRole('button', {
      name: 'Favorit Compact quick build entfernen',
      exact: true,
    })
    .click();
  await expect(card).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Windows build', exact: true }),
  ).toBeVisible();
});

test('compact cards preserve long labels, account context and click targets at 360px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await chooseAccount(page, 'team-demo');
  const dialog = await openLaunch(page);
  const label =
    'Nightly runner health checks for the shared maintenance environment';
  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog.getByLabel('Name des Favoriten').fill(label);
  await dialog.getByLabel('Schnellstart aktivieren', { exact: false }).check();
  await dialog
    .getByRole('button', { name: 'Favorit speichern', exact: true })
    .click();
  await expect(
    dialog.getByText(`„${label}“ als Favorit gespeichert.`, {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const card = templateCard(page, label);
  await expect(card).toContainText('example-org/runner-tools-demo');
  await expect(card).toContainText('team-demo');
  await expect(card.getByText('main', { exact: true })).toBeVisible();
  const sizes = await card.evaluate((element) => {
    const cardBounds = element.getBoundingClientRect();
    const account = element.querySelector('.pin-account')!;
    return {
      overflow: element.scrollWidth > element.clientWidth,
      // The repository name may shorten; the account context is never cut.
      accountClipped:
        account.scrollWidth > account.clientWidth ||
        account.getBoundingClientRect().right >
          element.querySelector('.pin-repo')!.getBoundingClientRect().right,
      font: parseFloat(getComputedStyle(element.querySelector('h3')!).fontSize),
      targets: [...element.querySelectorAll('button')].map((button) => {
        const r = button.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          inside: r.left >= cardBounds.left && r.right <= cardBounds.right,
        };
      }),
    };
  });
  expect(sizes.overflow).toBe(false);
  expect(sizes.accountClipped).toBe(false);
  expect(sizes.font).toBeGreaterThanOrEqual(12);
  for (const target of sizes.targets) {
    expect(target.width).toBeGreaterThanOrEqual(24);
    expect(target.height).toBeGreaterThanOrEqual(24);
    expect(target.inside).toBe(true);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
