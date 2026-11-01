import { expect, test } from './support/test';
import { backButton, expectPage, openPage } from './support/demo';
import {
  addable,
  allInTray,
  inTray,
  menuButton,
  notice,
  repoRow,
} from './support/picker';

test.describe('demo picker', () => {
  test('opens from the Repositories page and returns there with focus', async ({
    page,
  }) => {
    await page.goto('/');
    await openPage(page, 'repos');
    const add = page.getByRole('button', {
      name: 'Repositories hinzufügen',
      exact: true,
    });
    await add.click();
    await expectPage(page, 'picker');
    await expect(page.getByLabel('Repositories filtern')).toBeFocused();
    await expect(
      page.getByText('Änderungen gelten sofort – kein Speichern nötig.'),
    ).toBeVisible();
    // Esc leaves the empty search, then goes back one level.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expectPage(page, 'repos');
    await expect(add).toBeFocused();
    // The back button names where it leads.
    await add.click();
    await page
      .getByRole('button', { name: 'Zurück zu Repositories', exact: true })
      .click();
    await expectPage(page, 'repos');
  });

  test('the empty state opens the picker; an added repository is listed on return', async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        'repotray.demo.preferences.v1',
        JSON.stringify({ repoIds: [] }),
      ),
    );
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Repositories auswählen', exact: true })
      .click();
    await expectPage(page, 'picker');
    await expect(page.getByText('0 von höchstens 50')).toBeVisible();
    await addable(page, 'team-demo/sandbox-demo').click();
    await expect(inTray(page, 'team-demo/sandbox-demo')).toBeVisible();
    await expect(notice(page, 'sandbox-demo hinzugefügt.')).toBeVisible();
    await backButton(page).click();
    await expectPage(page, 'overview');
    await expect(repoRow(page, 'team-demo/sandbox-demo')).toBeVisible();
    // The empty state is gone; its twin, the section's „Hinzufügen“, has focus.
    await expect(
      page.getByRole('button', {
        name: 'Repositories hinzufügen',
        exact: true,
      }),
    ).toBeFocused();
  });

  test('the filter hides rows but keeps their state; undo flips only its repository', async ({
    page,
  }) => {
    await page.goto('/');
    await openPage(page, 'picker');
    // Grouped by account: avatar letter, login and label.
    await expect(page.locator('.picker-account')).toHaveText([
      /demo-dev\s*Personal · demo/,
      /team-demo\s*Work · demo/,
    ]);
    await page.getByLabel('Repositories filtern').fill('sandbox');
    await expect(page.locator('.pick')).toHaveCount(1);
    await addable(page, 'team-demo/sandbox-demo').click();
    await page.getByLabel('Repositories filtern').fill('');
    await expect(page.locator('.pick')).toHaveCount(4);
    await expect(allInTray(page)).toHaveCount(4);
    // Label in name (WCAG 2.5.3): each name starts with the visible text.
    for (const button of await page.locator('.pick-toggle').all())
      await expect(button).toHaveAccessibleName(
        new RegExp(`^${(await button.innerText()).trim()}: `),
      );
    await inTray(page, 'example-org/runner-tools-demo').click();
    await expect(
      notice(page, 'runner-tools-demo aus dem Tray entfernt.'),
    ).toBeVisible();
    await notice(page, 'sandbox-demo hinzugefügt.')
      .getByRole('button', { name: 'Rückgängig' })
      .click();
    await expect(addable(page, 'team-demo/sandbox-demo')).toBeVisible();
    // The other change stays.
    await expect(addable(page, 'example-org/runner-tools-demo')).toBeVisible();
    await expect(notice(page, 'sandbox-demo wieder entfernt.')).toBeVisible();
    await expect(page.getByText('2 von höchstens 50')).toBeVisible();
  });

  test('a search offers matches outside the tray, which move into the list once added', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByLabel('Übersicht durchsuchen').fill('sandbox');
    const outside = page.getByRole('region', {
      name: 'Nicht im Tray',
      exact: true,
    });
    // Nothing in the tray matches: only the matches outside it.
    await expect(
      page.getByRole('heading', { name: 'Keine Treffer' }),
    ).toHaveCount(0);
    await expect(outside).toContainText('team-demo · Schreibzugriff');
    const add = addable(page, 'team-demo/sandbox-demo');
    await expect(add).toHaveText('Hinzufügen');
    await add.click();
    const row = repoRow(page, 'team-demo/sandbox-demo');
    await expect(row).toBeVisible();
    await expect(outside).toHaveCount(0);
    await expect(row.locator('.repository-toggle')).toBeFocused();
    // The Repositories page offers the same while searching.
    await row.locator('.repo-menu-button').click();
    await page.getByRole('menuitem', { name: 'Aus Tray entfernen' }).click();
    await expect(row).toHaveCount(0);
    // Only „Nicht im Tray“ is left, without sections: Ctrl+1 opens the page.
    await page.keyboard.press('Control+1');
    await expectPage(page, 'repos');
    await expect(page.getByLabel('Repositories durchsuchen')).toHaveValue(
      'sandbox',
    );
    await addable(page, 'team-demo/sandbox-demo').click();
    await expect(row).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Nicht im Tray' }),
    ).toHaveCount(0);
  });

  test('demo rows keep the menu but offer no GitHub links', async ({
    page,
  }) => {
    await page.goto('/');
    await menuButton(page, 'demo-dev/launch-kit-demo').click();
    const menu = page.getByRole('menu', {
      name: 'Aktionen für demo-dev/launch-kit-demo',
    });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Letzten Run auf GitHub öffnen',
      'Link kopieren',
      'Aus Tray entfernen',
    ]);
    await expect(
      menu.getByRole('menuitem', { name: 'Link kopieren' }),
    ).toBeDisabled();
    await expect(
      menu.getByRole('menuitem', { name: 'Aus Tray entfernen' }),
    ).toBeFocused();
  });
});
