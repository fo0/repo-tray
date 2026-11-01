import type { Page } from '@playwright/test';
import fixture from '../../fixtures/demo.json' with { type: 'json' };
import { expectPage } from './demo';
import { installTauriMock } from './tauriMock';

export const notice = (page: Page, text: string) =>
  page.locator('.notice-banner').filter({ hasText: text });
/** A repository row of the overview or the Repositories page. */
export const repoRow = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true });
/** The „⋯“ button of a repository row. */
export const menuButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Aktionen für ${name}`, exact: true });

/**
 * Native panel (labelled IPC mock) on the demo fixture with demo-dev active;
 * its runs carry GitHub links. `more` adds that many synthetic, run-less
 * repositories of demo-dev, `demo-dev/bulk-00-demo` on.
 */
export async function openNative(page: Page, { more = 0 } = {}) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'repotray.activeAccount.v1',
      JSON.stringify('demo-personal'),
    ),
  );
  await installTauriMock<{ fixture: typeof fixture; more: number }, object>(
    page,
    ({ fixture, more }) => {
      const base = structuredClone(fixture);
      const link = (repoId: string, id: number) => {
        const repo = base.repos.find((item) => item.id === repoId)!;
        return `https://github.com/${repo.owner}/${repo.name}/actions/runs/${id}`;
      };
      const snapshot = {
        ...base,
        mode: 'live',
        stale: false,
        connectivity: 'online',
        message: undefined,
        runs: base.runs.map((run) => ({
          ...run,
          htmlUrl: link(run.repoId, run.id),
        })),
        repos: [
          ...base.repos,
          ...Array.from({ length: more }, (_, index) => ({
            ...base.repos[0]!,
            id: `bulk-${index}`,
            name: `bulk-${String(index).padStart(2, '0')}-demo`,
            pushedAt: '2026-10-01T08:00:00Z',
          })),
        ],
      };
      return (cmd) =>
        cmd === 'snapshot' || cmd === 'refresh_snapshot'
          ? structuredClone(snapshot)
          : null;
    },
    { arg: { fixture, more }, state: {} },
  );
  await page.goto('/');
  await expectPage(page, 'overview');
}
