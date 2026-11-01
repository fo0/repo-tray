import { expect, test } from './support/test';
import {
  backButton,
  chooseAccount,
  expectPage,
  openPage,
} from './support/demo';
import {
  addable,
  allInTray,
  inTray,
  notice,
  openNative,
  repoRow,
  selections,
} from './support/picker';

test.describe('native picker', () => {
  test('a toggle sends the whole selection at once; another account’s repository waits for it', async ({
    page,
  }) => {
    await openNative(page);
    await openPage(page, 'picker');
    await expect(page.locator('.picker-hint')).toHaveText([
      'Erscheint in der Übersicht, sobald team-demo · Work · demo aktiv ist.',
    ]);
    await addable(page, 'team-demo/sandbox-demo').click();
    await expect(inTray(page, 'team-demo/sandbox-demo')).toBeVisible();
    expect(await selections(page)).toEqual([
      [
        'demo-personal-kit',
        'demo-team-tools',
        'demo-personal-site',
        'demo-extra',
      ],
    ]);
    await expect(
      notice(
        page,
        'sandbox-demo hinzugefügt. Sichtbar, sobald team-demo · Work · demo aktiv ist.',
      ),
    ).toBeVisible();
    // The overview stays on the active account until the user switches.
    await backButton(page).click();
    await expect(repoRow(page, 'team-demo/sandbox-demo')).toHaveCount(0);
    await chooseAccount(page, 'team-demo · Work · demo');
    await expect(repoRow(page, 'team-demo/sandbox-demo')).toBeVisible();
  });

  test('rapid toggles collect into one more call, busy until it settled', async ({
    page,
  }) => {
    const mock = await openNative(page);
    await openPage(page, 'picker');
    await mock.configure({ delay: 600 });
    await addable(page, 'team-demo/sandbox-demo').click();
    await inTray(page, 'example-org/runner-tools-demo').click();
    await inTray(page, 'demo-dev/website-demo').click();
    // The wanted state shows at once, busy until confirmed.
    await expect(addable(page, 'demo-dev/website-demo')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(page.locator('.pick-toggle[aria-busy]')).toHaveCount(0, {
      timeout: 5000,
    });
    expect(await selections(page)).toEqual([
      [
        'demo-personal-kit',
        'demo-team-tools',
        'demo-personal-site',
        'demo-extra',
      ],
      ['demo-personal-kit', 'demo-extra'],
    ]);
    await expect(allInTray(page)).toHaveCount(2);
  });

  test('a full tray refuses another repository before calling the service', async ({
    page,
  }) => {
    await openNative(page, { many: true });
    await openPage(page, 'picker');
    await expect(page.getByText('50 von höchstens 50')).toBeVisible();
    await addable(page, 'demo-dev/launch-kit-demo').click();
    await expect(
      notice(
        page,
        'Höchstens 50 Repositories passen in den Tray. Entferne zuerst ein anderes.',
      ),
    ).toBeVisible();
    await expect(addable(page, 'demo-dev/launch-kit-demo')).toBeVisible();
    expect(await selections(page)).toEqual([]);
  });

  test('a refused change warns and shows the real selection again', async ({
    page,
  }) => {
    const mock = await openNative(page);
    await openPage(page, 'picker');
    await mock.configure({ fail: 'Wähle höchstens 50 bekannte Repositories.' });
    await addable(page, 'team-demo/sandbox-demo').click();
    await expect(
      notice(
        page,
        'Repository-Auswahl nicht geändert: Wähle höchstens 50 bekannte Repositories.',
      ),
    ).toBeVisible();
    await expect(addable(page, 'team-demo/sandbox-demo')).toBeVisible();
    await expect(addable(page, 'team-demo/sandbox-demo')).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  test('the search offers only the active account’s repositories outside the tray', async ({
    page,
  }) => {
    await openNative(page);
    await page.getByLabel('Übersicht durchsuchen').fill('sandbox');
    await expect(
      page.getByRole('heading', { name: 'Keine Treffer' }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Nicht im Tray' }),
    ).toHaveCount(0);
  });

  test('connecting another account lands in the picker with its banner', async ({
    page,
  }) => {
    await openNative(page);
    await page.getByRole('button', { name: / – Konto wechseln$/ }).click();
    await page.getByRole('menuitem', { name: 'Konto verbinden …' }).click();
    const dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
    await dialog.getByLabel('GitHub-Token').fill('synthetic-test-token');
    await dialog
      .getByRole('button', { name: 'Token prüfen und verbinden' })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectPage(page, 'picker');
    await expect(page.getByLabel('Repositories filtern')).toBeFocused();
    await expect(page.locator('.picker-banner')).toHaveText(
      'fixture-new ist verbunden. Wähle jetzt die Repositories, die in deinem Tray erscheinen sollen.',
    );
    // The new account is active now; the others wait for their turn.
    await expect(page.locator('.picker-hint')).toHaveText([
      'Erscheint in der Übersicht, sobald demo-dev · Personal · demo aktiv ist.',
      'Erscheint in der Übersicht, sobald team-demo · Work · demo aktiv ist.',
    ]);
    await addable(page, 'fixture-new/alpha').click();
    await expect(notice(page, 'alpha hinzugefügt.')).toBeVisible();
  });
});
