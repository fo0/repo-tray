import { expect, test } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { installTauriMock, readCalls } from './support/tauriMock';
import { openPage, templateCard } from './support/demo';

/**
 * Native panel whose start answers uncertain and persists a claim, like the
 * service. Disconnecting deletes the account's claims; connecting a token
 * brings the same account back without any.
 */
test.beforeEach(async ({ page }) => {
  await installTauriMock<{ fixture: typeof fixture }, object>(
    page,
    ({ fixture }) => {
      const base = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        // The service lists a newly connected account last.
        accounts: [...fixture.accounts].reverse(),
        uncertainStarts: [] as {
          accountId: string;
          repoId: string;
          workflowId: number;
          ref: string;
          claimedAt: string;
        }[],
      };
      let snapshot = structuredClone(base);
      return async (cmd, args) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(snapshot);
        if (cmd === 'dispatch_workflow') {
          const { accountId, repoId, workflowId, ref } = (
            args as { request: (typeof snapshot.uncertainStarts)[number] }
          ).request;
          snapshot.uncertainStarts = [
            {
              accountId,
              repoId,
              workflowId,
              ref,
              claimedAt: '2026-11-01T09:00:00Z',
            },
          ];
          return {
            state: 'uncertain',
            message: 'Mock: Antwort unterbrochen.',
          };
        }
        if (cmd === 'disconnect_account') {
          const id = String(args?.accountId);
          snapshot = {
            ...snapshot,
            accounts: snapshot.accounts.filter((item) => item.id !== id),
            repos: snapshot.repos.filter((repo) => repo.accountId !== id),
            pins: snapshot.pins.filter((pin) => pin.accountId !== id),
            uncertainStarts: snapshot.uncertainStarts.filter(
              (start) => start.accountId !== id,
            ),
          };
          return structuredClone(snapshot);
        }
        if (cmd === 'connect_token') {
          // The same GitHub account again; its claims stay deleted.
          snapshot = { ...structuredClone(base), uncertainStarts: [] };
          return structuredClone(snapshot);
        }
        return null;
      };
    },
    { arg: { fixture }, state: {} },
  );
  await page.addInitScript(() =>
    localStorage.setItem(
      'repotray.activeAccount.v1',
      JSON.stringify('demo-personal'),
    ),
  );
  await page.goto('/');
});

test('after an uncertain start, disconnecting and reconnecting the account unlocks the target', async ({
  page,
}) => {
  await openPage(page, 'favorites');
  const card = templateCard(page, 'Windows build');
  await card.locator('.pin-start').click();
  let dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await dialog.getByRole('button', { name: 'Workflow starten' }).click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();

  // „Trennen“ warns that the account's starts are unlocked afterwards.
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: 'Einstellungen' });
  const account = settings
    .locator('.connected-auth-card')
    .filter({ hasText: 'demo-dev' });
  await account.getByRole('button', { name: /trennen$/ }).click();
  await expect(account.getByRole('group')).toContainText('ungeklärte Starts');
  await account.getByRole('button', { name: 'Trennen', exact: true }).click();
  await expect(account).toHaveCount(0);

  await settings
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  const connect = page.getByRole('dialog', { name: 'GitHub verbinden' });
  await connect.getByLabel('GitHub-Token').fill('synthetic-test-token');
  await connect
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  // Connected again after its removal: a new account, so the overview follows.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.notice-banner')).toContainText(
    'Konto demo-dev verbunden.',
  );

  await openPage(page, 'favorites');
  await expect(card.locator('.uncertain-start')).toHaveCount(0);
  await card.locator('.pin-start').click();
  dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Workflow starten' }),
  ).toBeEnabled();
  expect(await readCalls(page, 'dispatch_workflow')).toHaveLength(1);
});
