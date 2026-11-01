import { expect, type Page } from '@playwright/test';

/** The overview or one of its sections maximized. */
export type PanelPage = 'overview' | 'runs' | 'favorites' | 'repos';
type Section = keyof typeof SECTION_TITLES;

/** Section titles on the overview; their maximize buttons are named after them. */
export const SECTION_TITLES = {
  runs: 'Läuft gerade',
  favorites: 'Favoriten',
  repos: 'Repositories',
} as const;
/** Titles of the pages. */
export const PAGE_TITLES = {
  runs: 'Verlauf',
  favorites: 'Favoriten',
  repos: 'Repositories',
} as const;

/** The maximize button in a section header of the overview. */
export function maximizeButton(page: Page, name: Section) {
  return page.getByRole('button', {
    name: `${SECTION_TITLES[name]} maximieren`,
    exact: true,
  });
}

/** The back button of a maximized page. */
export function backButton(page: Page) {
  return page.getByRole('button', {
    name: 'Zurück zur Übersicht',
    exact: true,
  });
}

/**
 * Shows `name` the way a user gets there: the back button returns to the
 * overview, a section's maximize button opens its page. Nothing happens when
 * the page is already shown.
 */
export async function openPage(page: Page, name: PanelPage) {
  const tray = page.locator('.tray');
  const current = await tray.getAttribute('data-page');
  if (current === name) return;
  if (current !== 'overview') await backButton(page).click();
  if (name !== 'overview') await maximizeButton(page, name).click();
  await expect(tray).toHaveAttribute('data-page', name);
}

/** Asserts the shown page: a maximized page by its title, else the overview. */
export async function expectPage(page: Page, name: PanelPage) {
  await expect(page.locator('.tray')).toHaveAttribute('data-page', name);
  const title = page.locator('.page-title');
  if (name === 'overview') await expect(title).toHaveCount(0);
  else await expect(title).toHaveText(PAGE_TITLES[name]);
}

/** Loads the browser demo and maximizes the runs: the Verlauf. */
export async function openDemoActivity(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /RepoTray/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
  await openPage(page, 'runs');
}

/** Opens a fresh launch dialog from the Favoriten page. */
export async function openLaunch(page: Page) {
  await openPage(page, 'favorites');
  await page
    .getByRole('button', { name: 'Workflow starten …', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Workflow starten' });
}

/** The header button that opens the account menu. */
export function accountMenuButton(page: Page) {
  return page.getByRole('button', { name: / – Konto wechseln$/ });
}

/**
 * Picks an account in the header account menu by its shown name, e.g.
 * `team-demo` or `Alle Konten` in the demo.
 */
export async function chooseAccount(page: Page, name: string) {
  await accountMenuButton(page).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/** Switches the demo scenario in settings and closes the dialog again. */
export async function scenario(page: Page, value: string) {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByLabel('Demo-Szenario').selectOption(value);
  await page.getByRole('button', { name: 'Dialog schließen' }).click();
}

/** Opens the demo connection dialog via settings. */
export async function openConnection(page: Page) {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'GitHub verbinden' });
}

/** A saved template card on the Favoriten page, found by its heading. */
export function templateCard(page: Page, name: string) {
  return page.getByRole('article').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

/**
 * Waits for running CSS transitions, e.g. a chevron that turns when its row
 * opens: a turning box measures wider than the settled one. Endless
 * animations such as the running strip cell's pulse are left alone.
 */
export async function settleTransitions(page: Page) {
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished),
    ),
  );
}
