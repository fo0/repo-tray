import { expect, test, type Page } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { installTauriMock, readCalls } from './support/tauriMock';
import { openLaunch, scenario, templateCard } from './support/demo';

type ReleaseMock = { releaseError: string; claimedAt: string };
const claim = {
  accountId: 'demo-personal',
  repoId: 'demo-personal-kit',
  workflowId: 101,
  ref: 'main',
  claimedAt: '2026-11-01T08:00:00Z',
};

/** Native shell after a restart: one persisted claim, account remembered. */
async function nativeWithClaim(page: Page) {
  const mock = await installTauriMock<
    { fixture: typeof fixture; claim: typeof claim },
    ReleaseMock
  >(
    page,
    ({ fixture, claim }, state) => {
      let released = false;
      const current = () => ({ ...claim, claimedAt: state.claimedAt });
      const snapshot = () => ({
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        uncertainStarts: released ? [] : [current()],
      });
      return (cmd, args) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot') return snapshot();
        if (cmd === 'release_uncertain_start') {
          if (state.releaseError) throw state.releaseError;
          // Like the service: only the claim it currently holds is released.
          const start = (args as { start: { claimedAt: string } }).start;
          if (start.claimedAt !== state.claimedAt)
            throw 'Für diesen Workflow auf diesem Branch oder Tag gibt es eine neuere Startsperre. Prüfe die Runs erneut.';
          released = true;
          return snapshot();
        }
        if (cmd === 'dispatch_workflow')
          throw 'Mock: Dieser Test startet nichts.';
        return null;
      };
    },
    {
      arg: { fixture, claim },
      state: { releaseError: '', claimedAt: claim.claimedAt },
    },
  );
  await page.addInitScript(() =>
    localStorage.setItem(
      'repotray.activeAccount.v1',
      JSON.stringify('demo-personal'),
    ),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  return mock;
}

test('a persisted claim locks the start after a restart until it is released explicitly', async ({
  page,
}) => {
  const mock = await nativeWithClaim(page);
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

  // A refused release keeps the lock, ends the confirmation and shows the reason.
  await mock.configure({
    releaseError: 'Mock: Die Sperre konnte nicht aufgehoben werden.',
  });
  await dialog.getByRole('button', { name: 'Sperre aufheben…' }).click();
  await confirm
    .getByRole('button', {
      name: 'Ich habe die Runs auf GitHub geprüft – Sperre aufheben',
    })
    .click();
  await expect(confirm).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveText(
    'Mock: Die Sperre konnte nicht aufgehoben werden.',
  );
  await expect(
    dialog.getByRole('button', { name: 'Sperre aufheben…' }),
  ).toBeFocused();
  await expect(start).toBeDisabled();

  await mock.configure({ releaseError: '' });
  await dialog.getByRole('button', { name: 'Sperre aufheben…' }).click();
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

test('a refused release refreshes the claim, so confirming again releases the newer one', async ({
  page,
}) => {
  const mock = await nativeWithClaim(page);
  await templateCard(page, 'Windows build').locator('.pin-start').click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  // Another start claimed the target again; the panel has not seen it yet.
  const newer = { ...claim, claimedAt: '2026-11-01T09:00:00Z' };
  await mock.configure({ claimedAt: newer.claimedAt });
  const ask = dialog.getByRole('button', { name: 'Sperre aufheben…' });
  const confirm = dialog.getByRole('group', { name: 'Sperre aufheben' });
  const release = confirm.getByRole('button', {
    name: 'Ich habe die Runs auf GitHub geprüft – Sperre aufheben',
  });
  await ask.click();
  await release.click();
  await expect(confirm).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toContainText(
    'gibt es eine neuere Startsperre',
  );
  await expect(ask).toBeFocused();
  await expect.poll(() => readCalls(page, 'refresh_snapshot')).toHaveLength(1);
  await expect(
    dialog.getByRole('button', { name: 'Workflow starten' }),
  ).toBeDisabled();

  // Confirming again releases the claim the refresh brought, nothing else.
  await ask.click();
  await release.click();
  await expect(
    dialog.getByText(
      'Sperre aufgehoben. Du kannst den Workflow wieder starten.',
    ),
  ).toBeVisible();
  expect(
    (await readCalls(page, 'release_uncertain_start')).map((call) => call.args),
  ).toEqual([{ start: claim }, { start: newer }]);
  expect(await readCalls(page, 'dispatch_workflow')).toEqual([]);
});

test('the confirmation releases the claim it opened with, not one a later refresh brought', async ({
  page,
}) => {
  const mock = await nativeWithClaim(page);
  await templateCard(page, 'Windows build').locator('.pin-start').click();
  const dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  const confirm = dialog.getByRole('group', { name: 'Sperre aufheben' });
  await dialog.getByRole('button', { name: 'Sperre aufheben…' }).click();
  // While the question is open, another start claims the target again and a
  // status check brings that newer claim into the panel.
  await mock.configure({
    claimedAt: '2026-11-01T09:00:00Z',
  });
  await dialog.getByRole('button', { name: 'Status prüfen' }).click();
  await expect.poll(() => readCalls(page, 'refresh_snapshot')).toHaveLength(1);
  await confirm
    .getByRole('button', {
      name: 'Ich habe die Runs auf GitHub geprüft – Sperre aufheben',
    })
    .click();
  // The service refuses the stale claim instead of silently releasing the newer one.
  await expect(dialog.getByRole('alert')).toContainText(
    'gibt es eine neuere Startsperre',
  );
  expect(
    (await readCalls(page, 'release_uncertain_start')).map((call) => call.args),
  ).toEqual([{ start: claim }]);
  expect(await readCalls(page, 'dispatch_workflow')).toEqual([]);
});
