import { expect, test, type Page } from './support/test';
import fixture from '../fixtures/demo.json' with { type: 'json' };
import { installTauriMock, readCalls } from './support/tauriMock';

type DisconnectMock = { failDisconnect: boolean; holdDisconnect: boolean };

/**
 * Two connections of one user (PAT and gh import), each with a favorite;
 * `uncertainFor` adds a locked start for that account.
 */
async function setup(page: Page, uncertainFor?: string) {
  const mock = await installTauriMock<
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
  const dialog = page.getByRole('dialog', {
    name: 'Einstellungen',
    exact: true,
  });
  return { dialog, mock };
}

const accounts = (page: Page) =>
  page.getByRole('radiogroup', { name: 'Aktives Konto', exact: true });
const card = (page: Page, source: string) =>
  accounts(page)
    .locator('.connected-auth-card')
    .filter({ hasText: `fixture-user · ${source}` });
const radio = (page: Page, source: string) =>
  accounts(page).getByRole('radio', {
    name: `fixture-user · ${source}`,
    exact: true,
  });

test('disconnect sits in the account card and asks first; Abbrechen keeps everything', async ({
  page,
}) => {
  const { dialog } = await setup(page);
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
  // One sentence: what goes.
  await expect(confirm).toHaveAccessibleDescription(
    'Zugang und Favoriten werden gelöscht.',
  );
  // A token connection has no gh CLI access to reassure about.
  await expect(confirm).not.toContainText('gh bleibt angemeldet');
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

test('an imported gh account confirms that the gh CLI stays untouched and focus moves to the account choice', async ({
  page,
}) => {
  await setup(page);
  await expect(accounts(page).getByRole('radio')).toHaveCount(2);
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
    'Zugang und Favoriten werden gelöscht, gh bleibt angemeldet.',
  );
  await confirm.getByRole('button', { name: 'Trennen', exact: true }).click();
  await expect(gh).toHaveCount(0);
  await expect(accounts(page).getByRole('radio')).toHaveCount(1);
  expect((await readCalls(page, 'disconnect_account'))[0]?.args).toEqual({
    accountId: 'github-gh-42',
  });
  // Focus lands on the account in effect, which is still checked.
  await expect(radio(page, 'Token')).toBeFocused();
  await expect(radio(page, 'Token')).toBeChecked();
});

test('removing the last account focuses the connect action; a failed disconnect keeps the card', async ({
  page,
}) => {
  const { mock } = await setup(page);
  await mock.configure({ failDisconnect: true });
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
  await mock.configure({ failDisconnect: false });
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
  // Focus moves to the remaining account, which stays unchecked.
  await expect(radio(page, 'gh CLI (Kopie)')).toBeFocused();
  await expect(radio(page, 'gh CLI (Kopie)')).not.toBeChecked();
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
  // Still one sentence, its second half the released lock.
  await expect(confirm).toHaveAccessibleDescription(
    'Zugang und Favoriten werden gelöscht, gh bleibt angemeldet; ungeklärte Starts sind danach nicht mehr gesperrt.',
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
  const { dialog, mock } = await setup(page);
  await mock.configure({ holdDisconnect: true });
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
  await mock.configure({ holdDisconnect: false });
  await expect(token).toHaveCount(0);
  await expect(radio(page, 'gh CLI (Kopie)')).toBeFocused();
  expect(await readCalls(page, 'disconnect_account')).toHaveLength(1);
});
