import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import {
  configureMock,
  installTauriMock,
  readCalls,
} from './support/tauriMock';

type DisconnectMock = { failDisconnect: boolean; holdDisconnect: boolean };

/**
 * Two connections of one user (PAT and gh import), each with a favorite;
 * `uncertainFor` adds a locked start for that account.
 */
async function setup(page: Page, uncertainFor?: string) {
  await installTauriMock<
    { fixture: typeof fixture; uncertainFor: string | null },
    DisconnectMock
  >(
    page,
    ({ fixture, uncertainFor }, state) => {
      const accounts = [
        { id: 'github-42', login: 'fixture-user', label: 'GitHub · Token' },
        {
          id: 'github-gh-42',
          login: 'fixture-user',
          label: 'GitHub · gh CLI (Kopie)',
        },
      ];
      let snapshot = {
        ...structuredClone(fixture),
        mode: 'live',
        stale: false,
        connectivity: 'online',
        accounts,
        repos: accounts.map((account) => ({
          ...fixture.repos[0],
          id: `${account.id}:repo`,
          accountId: account.id,
          selected: true,
        })),
        workflows: [],
        runs: [],
        pins: accounts.map((account) => ({
          ...fixture.pins[0],
          id: `${account.id}:pin`,
          accountId: account.id,
          repoId: `${account.id}:repo`,
        })),
        uncertainStarts: uncertainFor
          ? [
              {
                accountId: uncertainFor,
                repoId: `${uncertainFor}:repo`,
                workflowId: 1,
                ref: 'main',
                claimedAt: '2026-11-01T10:00:00Z',
              },
            ]
          : [],
      };
      return async (cmd, args) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(snapshot);
        if (cmd === 'disconnect_account') {
          while (state.holdDisconnect)
            await new Promise((resolve) => setTimeout(resolve, 20));
          if (state.failDisconnect)
            throw 'Mock: Zugang konnte nicht aus dem Tresor entfernt werden.';
          const id = String(args?.accountId);
          snapshot = {
            ...snapshot,
            accounts: snapshot.accounts.filter((account) => account.id !== id),
            repos: snapshot.repos.filter((repo) => repo.accountId !== id),
            pins: snapshot.pins.filter((pin) => pin.accountId !== id),
            uncertainStarts: snapshot.uncertainStarts.filter(
              (start) => start.accountId !== id,
            ),
          };
          return structuredClone(snapshot);
        }
        return null;
      };
    },
    {
      arg: { fixture, uncertainFor: uncertainFor ?? null },
      state: { failDisconnect: false, holdDisconnect: false },
    },
  );
  await page.addInitScript(() =>
    localStorage.setItem(
      'repotray.activeAccount.v1',
      JSON.stringify('github-42'),
    ),
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Einstellungen', exact: true });
}

const card = (page: Page, source: string) =>
  page
    .getByRole('region', { name: 'Verbundene Anmeldungen' })
    .locator('.connected-auth-card')
    .filter({ hasText: `fixture-user · ${source}` });

test('disconnect sits in the account card and asks first; Abbrechen keeps everything', async ({
  page,
}) => {
  const dialog = await setup(page);
  const token = card(page, 'Token');
  const trigger = token.getByRole('button', {
    name: 'fixture-user · Token trennen',
    exact: true,
  });
  await trigger.click();
  // The title names login and source: two connections of one user differ.
  const confirm = token.getByRole('group', {
    name: 'fixture-user · Token trennen?',
    exact: true,
  });
  await expect(confirm).toHaveAccessibleDescription(
    'Gespeicherter Zugang, Repository-Auswahl und Favoriten dieses Kontos werden gelöscht.',
  );
  // A token connection has no gh CLI access to reassure about.
  await expect(confirm).not.toContainText('gh-CLI-Zugang');
  // No locked start for this account, so nothing to warn about.
  await expect(confirm).not.toContainText('ungeklärte Starts');
  await expect(
    confirm.getByRole('button', { name: 'Abbrechen', exact: true }),
  ).toBeFocused();
  // Only one confirmation at a time.
  await expect(
    card(page, 'gh CLI (Kopie)').getByRole('button', { name: /trennen$/ }),
  ).toBeDisabled();
  await confirm.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Escape cancels the confirmation, not the settings dialog.
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await readCalls(page, 'disconnect_account')).toHaveLength(0);
});

test('an imported gh account confirms that the gh CLI stays untouched and focus moves to the account picker', async ({
  page,
}) => {
  await setup(page);
  await expect(
    page.getByText('2 Konten verbunden', { exact: true }),
  ).toBeVisible();
  const gh = card(page, 'gh CLI (Kopie)');
  await gh
    .getByRole('button', {
      name: 'fixture-user · gh CLI (Kopie) trennen',
      exact: true,
    })
    .click();
  const confirm = gh.getByRole('group', {
    name: 'fixture-user · gh CLI (Kopie) trennen?',
    exact: true,
  });
  await expect(confirm).toHaveAccessibleDescription(
    'Gespeicherter Zugang, Repository-Auswahl und Favoriten dieses Kontos werden gelöscht. Der gh-CLI-Zugang selbst bleibt unberührt.',
  );
  await confirm.getByRole('button', { name: 'Trennen', exact: true }).click();
  await expect(gh).toHaveCount(0);
  await expect(
    page.getByText('1 Konto verbunden', { exact: true }),
  ).toBeVisible();
  expect((await readCalls(page, 'disconnect_account'))[0].args).toEqual({
    accountId: 'github-gh-42',
  });
  const picker = page.getByLabel('Aktives Konto auswählen', { exact: true });
  await expect(picker).toBeFocused();
  await expect(picker).toHaveValue('github-42');
});

test('removing the last account focuses the connect action; a failed disconnect keeps the card', async ({
  page,
}) => {
  await setup(page);
  await configureMock<DisconnectMock>(page, { failDisconnect: true });
  const token = card(page, 'Token');
  const trigger = token.getByRole('button', {
    name: 'fixture-user · Token trennen',
    exact: true,
  });
  await trigger.click();
  await token.getByRole('button', { name: 'Trennen', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Zugang konnte nicht aus dem Tresor entfernt werden',
  );
  await expect(token).toBeVisible();
  await expect(trigger).toBeFocused();
  await configureMock<DisconnectMock>(page, { failDisconnect: false });
  for (const source of ['gh CLI (Kopie)', 'Token']) {
    const current = card(page, source);
    await current.getByRole('button', { name: /trennen$/ }).click();
    await current.getByRole('button', { name: 'Trennen', exact: true }).click();
    await expect(current).toHaveCount(0);
  }
  await expect(
    page.getByRole('button', { name: 'GitHub-Konto verbinden', exact: true }),
  ).toBeFocused();
});

test('removing the active account while another remains never picks a replacement', async ({
  page,
}) => {
  await setup(page);
  const token = card(page, 'Token');
  await token
    .getByRole('button', { name: 'fixture-user · Token trennen', exact: true })
    .click();
  await token.getByRole('button', { name: 'Trennen', exact: true }).click();
  await expect(token).toHaveCount(0);
  const picker = page.getByLabel('Aktives Konto auswählen', { exact: true });
  await expect(picker).toBeFocused();
  await expect(picker).toHaveValue('');
  await expect(
    page
      .getByRole('tabpanel', { name: 'Konten' })
      .getByRole('status')
      .filter({ hasText: 'Das aktive Konto wurde entfernt.' }),
  ).toHaveText(
    'Das aktive Konto wurde entfernt. Wähle ein anderes aktives Konto aus.',
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem('repotray.activeAccount.v1'),
    ),
  ).toBeNull();
});

test('an account with locked starts warns that disconnecting releases the lock', async ({
  page,
}) => {
  await setup(page, 'github-gh-42');
  const gh = card(page, 'gh CLI (Kopie)');
  await gh.getByRole('button', { name: /trennen$/ }).click();
  const confirm = gh.getByRole('group', {
    name: 'fixture-user · gh CLI (Kopie) trennen?',
    exact: true,
  });
  await expect(confirm).toHaveAccessibleDescription(
    'Gespeicherter Zugang, Repository-Auswahl und Favoriten dieses Kontos werden gelöscht. Der gh-CLI-Zugang selbst bleibt unberührt. Achtung: Für dieses Konto gibt es ungeklärte Starts. Nach dem Trennen sind sie nicht mehr gesperrt – prüfe die Runs auf GitHub vorher.',
  );
  await confirm.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  // The other connection of the same user has no locked start.
  const token = card(page, 'Token');
  await token.getByRole('button', { name: /trennen$/ }).click();
  await expect(token.getByRole('group')).not.toContainText('ungeklärte Starts');
});

test('a running disconnect keeps focus in its confirmation; Abbrechen and Escape wait for it', async ({
  page,
}) => {
  const dialog = await setup(page);
  await configureMock<DisconnectMock>(page, { holdDisconnect: true });
  const token = card(page, 'Token');
  await token.getByRole('button', { name: /trennen$/ }).click();
  const confirm = token.getByRole('group', {
    name: 'fixture-user · Token trennen?',
    exact: true,
  });
  const cancel = confirm.getByRole('button', {
    name: 'Abbrechen',
    exact: true,
  });
  await confirm.getByRole('button', { name: 'Trennen', exact: true }).focus();
  await page.keyboard.press('Enter');
  const running = confirm.getByRole('button', {
    name: 'Wird getrennt …',
    exact: true,
  });
  // Focusable while busy (aria-disabled, not disabled), so focus stays here.
  await expect(running).toBeFocused();
  await expect(running).toHaveAttribute('aria-disabled', 'true');
  await expect(cancel).toHaveAttribute('aria-disabled', 'true');
  // A second activation never sends a second disconnect.
  await page.keyboard.press('Enter');
  // Escape neither hides the question nor closes the settings dialog.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(running).toBeFocused();
  // Abbrechen is inert: the disconnect finishes either way.
  await cancel.click({ force: true });
  await expect(confirm).toBeVisible();
  await configureMock<DisconnectMock>(page, { holdDisconnect: false });
  await expect(token).toHaveCount(0);
  await expect(
    page.getByLabel('Aktives Konto auswählen', { exact: true }),
  ).toBeFocused();
  expect(await readCalls(page, 'disconnect_account')).toHaveLength(1);
});
