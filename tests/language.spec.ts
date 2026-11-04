import { expect, test, type Page } from './support/test';

/**
 * „Sprache“ in Einstellungen → App: an explicit language overrides the system
 * language, survives a reload and sets `lang` on <html>; „System“ follows the
 * browser locale again (the config runs with de-DE).
 */
const dialog = (page: Page) => page.getByRole('dialog');
/** The language group's radios; „Darstellung“ has a „System“ too. */
const languageRadio = (page: Page, name: string) =>
  dialog(page)
    .getByRole('radiogroup', { name: /^(Sprache|Language)$/ })
    .getByRole('radio', { name, exact: true });
const htmlLang = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('lang'));

async function openApp(page: Page, settings: string, app = 'App') {
  await page.getByRole('button', { name: settings, exact: true }).click();
  await dialog(page).getByRole('tab', { name: app, exact: true }).click();
}

async function expectGerman(page: Page) {
  await expect(page.getByLabel('Übersicht durchsuchen')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Repositories maximieren', exact: true }),
  ).toBeVisible();
  expect(await htmlLang(page)).toBe('de');
}

async function expectEnglish(page: Page) {
  const search = page.getByLabel('Search overview', { exact: true });
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute(
    'placeholder',
    'Search workflow, repository or branch…',
  );
  await expect(
    page.getByRole('button', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Maximize Repositories', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Actions for / }).first(),
  ).toBeVisible();
  expect(await htmlLang(page)).toBe('en');
}

test('an explicit English overrides the German system language, persists, and „System“ returns to German', async ({
  page,
}) => {
  await page.goto('/');
  await expectGerman(page);

  await openApp(page, 'Einstellungen');
  await expect(
    dialog(page).getByRole('heading', { name: 'Sprache', exact: true }),
  ).toBeVisible();
  await languageRadio(page, 'English').check();
  // The choice previews at once, the dialog included.
  await expect(
    dialog(page).getByRole('heading', { name: 'Language', exact: true }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('tab', { name: 'Accounts', exact: true }),
  ).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectEnglish(page);

  await page.reload();
  await expectEnglish(page);

  await openApp(page, 'Settings');
  await expect(languageRadio(page, 'English')).toBeChecked();
  await languageRadio(page, 'System').check();
  await expect(
    dialog(page).getByRole('heading', { name: 'Sprache', exact: true }),
  ).toBeVisible();
  await dialog(page)
    .getByRole('button', { name: 'Speichern', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expectGerman(page);
  await page.reload();
  await expectGerman(page);
});

test.describe('an English system', () => {
  test.use({ locale: 'en-US' });

  test('„System“ shows English by detection', async ({ page }) => {
    await page.goto('/');
    await expectEnglish(page);
    await openApp(page, 'Settings');
    await expect(languageRadio(page, 'System')).toBeChecked();
    await expect(
      dialog(page).getByRole('heading', { name: 'Language', exact: true }),
    ).toBeVisible();
  });
});
