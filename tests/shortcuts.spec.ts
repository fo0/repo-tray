import { expect, test, type Page } from './support/test';
import { openConnection } from './support/demo';

const tab = (page: Page, name: RegExp) => page.getByRole('button', { name });
const views = {
  repositories: /^Repositories$/,
  activity: /^Aktivität/,
  launch: /^Favoriten$/,
};
const refreshed = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Demo-Status aktualisiert.' });

/** Records, after the panel's own handler, whether a key kept its default. */
async function watchDefaults(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { __defaults: seen });
    window.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) seen.push(event.key);
    });
  });
}
const prevented = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __defaults: string[] }).__defaults,
  );

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
  await watchDefaults(page);
});

test('F5 and Ctrl+R refresh the panel instead of reloading the webview', async ({
  page,
}) => {
  await page.evaluate(() => Object.assign(window, { __sameDocument: true }));
  await page.keyboard.press('F5');
  await expect(refreshed(page)).toBeVisible();
  await page
    .getByRole('status')
    .getByRole('button', { name: 'Meldung schließen' })
    .click();
  await page.keyboard.press('Control+r');
  await expect(refreshed(page)).toBeVisible();
  expect(await prevented(page)).toEqual(['F5', 'r']);
  expect(
    await page.evaluate(
      () => (window as unknown as { __sameDocument?: true }).__sameDocument,
    ),
  ).toBe(true);
});

test('Ctrl+1/2/3 switch between the views', async ({ page }) => {
  await page.keyboard.press('Control+2');
  await expect(tab(page, views.activity)).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.keyboard.press('Control+3');
  await expect(tab(page, views.launch)).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Control+1');
  await expect(tab(page, views.repositories)).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(tab(page, views.activity)).toHaveAttribute(
    'aria-keyshortcuts',
    'Control+2',
  );
});

test('/ focuses the search; typing keeps plain keys, Escape clears then leaves', async ({
  page,
}) => {
  const search = page.getByLabel('Repositories durchsuchen');
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await page.keyboard.type('demo/1');
  await expect(search).toHaveValue('demo/1');
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).not.toBeFocused();
});

test('F5, Ctrl+R and Ctrl+1/2/3 still work from the search field', async ({
  page,
}) => {
  const search = page.getByLabel('Repositories durchsuchen');
  await page.keyboard.press('/');
  await page.keyboard.type('demo');
  await page.keyboard.press('F5');
  await expect(refreshed(page)).toBeVisible();
  await expect(search).toHaveValue('demo');
  await expect(search).toBeFocused();
  await page
    .getByRole('status')
    .getByRole('button', { name: 'Meldung schließen' })
    .click();
  await search.focus();
  await page.keyboard.press('Control+r');
  await expect(refreshed(page)).toBeVisible();
  await search.focus();
  await page.keyboard.press('Control+2');
  await expect(tab(page, views.activity)).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await prevented(page)).toEqual(['/', 'F5', 'r', '2']);
});

test('an open dialog keeps the keyboard and never reloads', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Einstellungen' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Control+2');
  await page.keyboard.press('/');
  await page.keyboard.press('F5');
  expect(await prevented(page)).toEqual(['F5']);
  await expect(refreshed(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(tab(page, views.repositories)).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('the search hint lists the keyboard shortcuts', async ({ page }) => {
  const hint = page.locator('.search-field kbd');
  await expect(hint).toHaveText('/');
  const title = await hint.getAttribute('title');
  expect(title).toContain('Tastenkürzel');
  for (const entry of ['F5 oder Strg+R', 'Strg+1, 2, 3', 'Esc'])
    expect(title).toContain(entry);
  await expect(
    page.getByRole('button', { name: 'Aktualisieren', exact: true }),
  ).toHaveAttribute('aria-keyshortcuts', 'F5 Control+R');
});

// Focus regressions: SearchField.focus() and Toolbar.focusPicker().
test('pressing / on a run row moves focus into the search field', async ({
  page,
}) => {
  await page.keyboard.press('Control+2');
  await page.locator('.run-button').first().focus();
  await page.keyboard.press('/');
  await expect(page.getByLabel('Aktivität durchsuchen')).toBeFocused();
  await expect(page.getByLabel('Aktivität durchsuchen')).toHaveValue('');
});

test('finishing the demo token connect focuses the account picker', async ({
  page,
}) => {
  const dialog = await openConnection(page);
  await dialog
    .getByText('Alternativ: Token hinterlegen', { exact: true })
    .click();
  await dialog.getByLabel('Beispiel-Token').fill('demo-token');
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByLabel('Konto auswählen', { exact: true }),
  ).toBeFocused();
});
