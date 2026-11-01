import { expect, test } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { installTauriMock } from './support/tauriMock';
import { templateCard } from './support/demo';

const NOTE = 'Zu viele Umgebungen – Auswahl nicht verfügbar.';

test('an environment input the service could not list shows its note and offers no values', async ({
  page,
}) => {
  await installTauriMock<{ fixture: typeof fixture; note: string }, object>(
    page,
    ({ fixture, note }) => {
      const snapshot = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        message: undefined,
        workflows: fixture.workflows.map((workflow) => ({
          ...workflow,
          inputs: [
            ...workflow.inputs,
            {
              name: 'deploy_target',
              label: 'Umgebung',
              type: 'environment',
              required: false,
              options: [],
              note,
            },
          ],
        })),
      };
      return (cmd) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot') return snapshot;
        if (cmd === 'dispatch_workflow')
          throw 'Mock: Dieser Test startet nichts.';
        return null;
      };
    },
    { arg: { fixture, note: NOTE }, state: {} },
  );
  await page.addInitScript(() =>
    localStorage.setItem(
      'repotray.activeAccount.v1',
      JSON.stringify('demo-personal'),
    ),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await templateCard(page, 'Windows build').locator('.pin-start').click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  const select = dialog.getByRole('combobox', { name: 'Umgebung' });
  await expect(select).toHaveAccessibleDescription(NOTE);
  await expect(select.locator('option')).toHaveText(['Nicht gesetzt']);
});
