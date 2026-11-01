import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import {
  configureMock,
  installTauriMock,
  readCalls,
} from './support/tauriMock';
import { openLaunch, scenario, templateCard } from './support/demo';

type ReleaseMock = { releaseError: string };
const claim = {
  accountId: 'demo-personal',
  repoId: 'demo-personal-kit',
  workflowId: 101,
  ref: 'main',
  claimedAt: '2026-11-01T08:00:00Z',
};

/** Native shell after a restart: one persisted claim, account remembered. */
async function nativeWithClaim(page: Page) {
  await installTauriMock<
    { fixture: typeof fixture; claim: typeof claim },
    ReleaseMock
  >(
    page,
    ({ fixture, claim }, state) => {
      let snapshot = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        uncertainStarts: [claim],
      };
      return (cmd, args) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(snapshot);
        if (cmd === 'release_uncertain_start') {
          if (state.releaseError) throw state.releaseError;
          snapshot = { ...snapshot, uncertainStarts: [] };
          return structuredClone(snapshot);
        }
        if (cmd === 'dispatch_workflow')
          throw 'Mock: Dieser Test startet nichts.';
        return null;
      };
    },
    { arg: { fixture, claim }, state: { releaseError: '' } },
  );
  await page.addInitScript(() =>
    localStorage.setItem(
      'repotray.activeAccount.v1',
      JSON.stringify('demo-personal'),
    ),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
}

test('a persisted claim locks the start after a restart until it is released explicitly', async ({
  page,
}) => {
  await nativeWithClaim(page);
  const card = templateCard(page, 'Windows build');
  await expect(
    card.getByRole('button', { name: 'Startstatus ungeklärt', exact: true }),
  ).toBeVisible();
  await card.locator('.pin-start').click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  const start = dialog.getByRole('button', { name: 'Workflow starten' });
  await expect(dialog.getByText('Startstatus ungeklärt')).toBeVisible();
  await expect(start).toBeDisabled();

  // Asking first, then backing out, releases nothing.
  await dialog.getByRole('button', { name: 'Sperre aufheben…' }).click();
  const confirm = dialog.getByRole('group', { name: 'Sperre aufheben' });
  await expect(
    confirm.getByRole('button', { name: 'Abbrechen' }),
  ).toBeFocused();
  await confirm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Sperre aufheben…' }),
  ).toBeFocused();
  expect(await readCalls(page, 'release_uncertain_start')).toEqual([]);

  // A refused release keeps the lock and shows the reason.
  await configureMock<ReleaseMock>(page, {
    releaseError:
      'Für diesen Workflow und Branch gibt es eine neuere Startsperre.',
  });
  await dialog.getByRole('button', { name: 'Sperre aufheben…' }).click();
  await confirm
    .getByRole('button', {
      name: 'Ich habe die Runs auf GitHub geprüft – Sperre aufheben',
    })
    .click();
  await expect(confirm.getByRole('alert')).toHaveText(
    'Für diesen Workflow und Branch gibt es eine neuere Startsperre.',
  );
  await expect(start).toBeDisabled();

  await configureMock<ReleaseMock>(page, { releaseError: '' });
  await confirm
    .getByRole('button', {
      name: 'Ich habe die Runs auf GitHub geprüft – Sperre aufheben',
    })
    .click();
  await expect(
    dialog.getByRole('status').filter({
      hasText: 'Sperre aufgehoben. Du kannst den Workflow wieder starten.',
    }),
  ).toBeFocused();
  await expect(dialog.getByText('Startstatus ungeklärt')).toHaveCount(0);
  await expect(start).toBeEnabled();
  // Exactly the reported claim was released, and nothing was started.
  expect(
    (await readCalls(page, 'release_uncertain_start')).map((call) => call.args),
  ).toEqual([{ start: claim }, { start: claim }]);
  expect(await readCalls(page, 'dispatch_workflow')).toEqual([]);
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(
    card.getByRole('button', { name: 'Startstatus ungeklärt', exact: true }),
  ).toHaveCount(0);
});

test('the demo releases its own uncertain start the same way', async ({
  page,
}) => {
  await page.goto('/');
  await scenario(page, 'uncertain');
  let dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Sperre aufheben…' }).click();
  await dialog
    .getByRole('group', { name: 'Sperre aufheben' })
    .getByRole('button', {
      name: 'Ich habe die Runs auf GitHub geprüft – Sperre aufheben',
    })
    .click();
  await expect(
    dialog.getByText(
      'Sperre aufgehoben. Du kannst den Workflow wieder starten.',
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeEnabled();
  // Releasing started nothing.
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  await expect(page.getByText(/9001/)).toHaveCount(0);
  await scenario(page, 'normal');
  dialog = await openLaunch(page);
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(dialog.getByText(/Demo-Run #9001/)).toBeVisible();
});
