import { expect, test } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { installTauriMock, readCalls } from './support/tauriMock';
import { openDemoActivity, openPage, templateCard } from './support/demo';

/** A favorite row's buttons, by their accessible names. */
const button = (
  page: Parameters<typeof templateCard>[0],
  label: string,
  name: string,
) =>
  templateCard(page, label).getByRole('button', {
    name: `launch-kit-demo · ${label} ${name}`,
    exact: true,
  });

test('a favorite that still needs input opens the start dialog instead of starting', async ({
  page,
}) => {
  // Labelled IPC mock: the stored favorite lost its required `version`.
  await installTauriMock<{ fixture: typeof fixture }, object>(
    page,
    ({ fixture }) => {
      const snapshot = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        message: undefined,
        pins: fixture.pins.map((pin) => ({
          ...pin,
          inputs: { target: pin.inputs.target, dry_run: pin.inputs.dry_run },
        })),
      };
      return (cmd) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot') return snapshot;
        if (cmd === 'dispatch_workflow')
          throw 'Mock: Dieser Test startet nichts.';
        return null;
      };
    },
    { arg: { fixture }, state: {} },
  );
  await page.addInitScript(() =>
    localStorage.setItem(
      'repowatch.activeAccount.v1',
      JSON.stringify('demo-personal'),
    ),
  );
  await page.goto('/');
  await openPage(page, 'favorites');
  await button(page, 'Windows build', 'starten').click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(dialog.getByLabel('Version', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Branch oder Tag')).toHaveValue('main');
  // The favorite section is open to fix and update the stored defaults.
  await expect(
    dialog.getByRole('button', { name: 'Favorit aktualisieren', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel('Name des Favoriten')).toHaveValue(
    'Windows build',
  );
  expect(await readCalls(page, 'dispatch_workflow')).toEqual([]);
});

test('the settings button edits the defaults the direct start then sends', async ({
  page,
}) => {
  await openDemoActivity(page);
  await openPage(page, 'favorites');
  const edit = button(page, 'Windows build', 'bearbeiten');
  await expect(edit).toHaveAttribute('title', 'Standardwerte bearbeiten');
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(dialog.getByLabel('Version', { exact: true })).toHaveValue(
    '0.1.0',
  );
  await dialog.getByLabel('Branch oder Tag').selectOption('develop');
  await dialog.getByLabel('Name des Favoriten').fill('Develop build');
  await dialog
    .getByRole('button', { name: 'Favorit aktualisieren', exact: true })
    .click();
  await expect(
    dialog.getByText('„Develop build“ als Favorit gespeichert.', {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();

  // Updated in place, not copied: one row, now on develop.
  await expect(page.locator('.pin-row')).toHaveCount(1);
  const row = templateCard(page, 'Develop build');
  await expect(row.locator('.branch-chip')).toHaveText('develop');
  await button(page, 'Develop build', 'starten').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: /Develop build: .*#9001/ }),
  ).toBeVisible();
});
