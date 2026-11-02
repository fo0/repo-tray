import { expect, test, type Page } from './support/test';
import {
  PAGE_TITLES,
  SECTION_TITLES,
  expectPage,
  maximizeButton,
} from './support/demo';
import { installTauriMock } from './support/tauriMock';

type SectionName = keyof typeof SECTION_TITLES;

const section = (page: Page, name: SectionName) =>
  page.getByRole('region', { name: SECTION_TITLES[name], exact: true });
const pageTitle = (page: Page, name: SectionName) =>
  page.getByRole('heading', { level: 2, name: PAGE_TITLES[name], exact: true });
const more = (page: Page) => page.getByRole('button', { name: /weitere/ });

// More open runs, favorites and repositories than the overview shows: a
// labelled native IPC mock with synthetic data only.
test.describe('capped overview', () => {
  const NOW = Date.parse('2026-11-01T09:00:00Z');
  const ago = (minutes: number) =>
    new Date(NOW - minutes * 60_000).toISOString();
  // The service selects up to 10 newest repositories plus those of favorites.
  const repos = Array.from({ length: 12 }, (_, index) => ({
    id: `cap-repo-${index}`,
    accountId: 'github-4242',
    owner: 'cap-org',
    name: `cap-repo-${String(index).padStart(2, '0')}`,
    defaultBranch: 'main',
    pushedAt: ago(60 + index),
    selected: true,
    permission: 'write',
  }));
  const snapshot = {
    accounts: [{ id: 'github-4242', login: 'cap-user', label: 'Personal' }],
    repos,
    workflows: repos.map((repo, index) => ({
      id: 100 + index,
      repoId: repo.id,
      name: `Build ${index}`,
      path: `.github/workflows/build-${index}.yml`,
      dispatch: true,
      inputs: [],
      refs: ['main'],
    })),
    runs: Array.from({ length: 5 }, (_, index) => ({
      id: 7000 + index,
      repoId: `cap-repo-${index}`,
      workflowId: 100 + index,
      name: `Build ${index}`,
      branch: 'main',
      status: 'in_progress',
      conclusion: null,
      createdAt: ago(10 + index),
      updatedAt: ago(1),
      htmlUrl: '',
    })),
    pins: Array.from({ length: 6 }, (_, index) => ({
      id: `cap-pin-${index}`,
      label: `Pinned ${index}`,
      accountId: 'github-4242',
      repoId: `cap-repo-${index}`,
      workflowId: 100 + index,
      ref: 'main',
      inputs: {},
      quickStart: false,
    })),
    mode: 'live',
    connectivity: 'online',
    updatedAt: ago(0),
    stale: false,
  };

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        'repotray.activeAccount.v1',
        JSON.stringify('github-4242'),
      ),
    );
    // Labelled IPC mock with synthetic data only.
    await installTauriMock<{ snapshot: typeof snapshot }, object>(
      page,
      ({ snapshot }) =>
        (cmd) =>
          cmd === 'snapshot' || cmd === 'refresh_snapshot'
            ? structuredClone(snapshot)
            : null,
      { arg: { snapshot }, state: {} },
    );
    await page.goto('/');
    await expect(maximizeButton(page, 'runs')).toBeVisible();
  });

  test('caps each section and „+N weitere“ opens the full page', async ({
    page,
  }) => {
    await expect(section(page, 'runs').getByRole('listitem')).toHaveCount(3);
    await expect(section(page, 'favorites').locator('.pin-row')).toHaveCount(4);
    await expect(
      section(page, 'repos').locator('.repository-card'),
    ).toHaveCount(10);
    // The header counts everything, not only the rows shown.
    await expect(section(page, 'runs')).toContainText('5 Runs');
    await expect(section(page, 'favorites')).toContainText('6 Favoriten');
    await expect(section(page, 'repos')).toContainText('12 Repositories');
    // The tray picks its repositories itself: no way to add one by hand.
    await expect(page.getByRole('button', { name: /Hinzufügen/ })).toHaveCount(
      0,
    );

    for (const [name, label, count, rows] of [
      ['runs', '+2 weitere Runs anzeigen', 5, 'article.run'],
      ['favorites', '+2 weitere Favoriten anzeigen', 6, '.pin-row'],
      ['repos', '+2 weitere Repositories anzeigen', 12, '.repository-card'],
    ] as const) {
      const button = section(page, name).getByRole('button', {
        name: label,
        exact: true,
      });
      await expect(button).toHaveText('+2 weitere');
      await button.click();
      await expectPage(page, name);
      await expect(pageTitle(page, name)).toBeFocused();
      await expect(page.locator(rows)).toHaveCount(count);
      await page.keyboard.press('Escape');
      await expect(button).toBeFocused();
    }
  });

  test('„+N weitere“ under the runs lists them even after a Verlauf filter that hides them', async ({
    page,
  }) => {
    await maximizeButton(page, 'runs').click();
    await page.getByRole('button', { name: /^Fehlgeschlagen/ }).click();
    await expect(page.locator('article.run')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await section(page, 'runs')
      .getByRole('button', { name: '+2 weitere Runs anzeigen', exact: true })
      .click();
    await expectPage(page, 'runs');
    await expect(
      page.getByRole('button', { name: /^Aktiv\b/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('article.run')).toHaveCount(5);
  });

  test('a search lifts the caps', async ({ page }) => {
    await page.getByLabel('Übersicht durchsuchen').fill('cap');
    await expect(section(page, 'runs').getByRole('listitem')).toHaveCount(5);
    await expect(section(page, 'favorites').locator('.pin-row')).toHaveCount(6);
    await expect(
      section(page, 'repos').locator('.repository-card'),
    ).toHaveCount(12);
    await expect(more(page)).toHaveCount(0);
    await page.getByLabel('Übersicht durchsuchen').fill('');
    await expect(more(page)).toHaveCount(3);
  });
});
