import type { Page } from '@playwright/test';
import fixture from '../../fixtures/demo.json' with { type: 'json' };
import { expectPage } from './demo';
import { installTauriMock, readCalls } from './tauriMock';

type PickerMock = { delay: number; fail: string };

/**
 * A picker toggle by its state: the accessible name starts with the visible
 * text, „Im Tray“ or „Hinzufügen“ (label in name), then the repository.
 */
export const inTray = (page: Page, name: string) =>
  page.getByRole('button', { name: `Im Tray: ${name}`, exact: true });
export const addable = (page: Page, name: string) =>
  page.getByRole('button', { name: `Hinzufügen: ${name}`, exact: true });
/** Every toggle that reads „Im Tray“. */
export const allInTray = (page: Page) =>
  page.getByRole('button', { name: /^Im Tray: / });
export const notice = (page: Page, text: string) =>
  page.locator('.notice-banner').filter({ hasText: text });
/** A repository row of the overview or the Repositories page. */
export const repoRow = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true });
/** The „⋯“ button of a repository row. */
export const menuButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Aktionen für ${name}`, exact: true });

/**
 * Native panel (labelled IPC mock) on the demo fixture with demo-dev active:
 * `select_repos` applies the ids after `delay` ms or rejects with `fail`;
 * `many` fills the tray with 50 other repositories first.
 */
export async function openNative(page: Page, { many = false } = {}) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'repotray.activeAccount.v1',
      JSON.stringify('demo-personal'),
    ),
  );
  const mock = await installTauriMock<
    { fixture: typeof fixture; many: boolean },
    PickerMock
  >(
    page,
    ({ fixture, many }, state) => {
      const base = structuredClone(fixture);
      const link = (repoId: string, id: number) => {
        const repo = base.repos.find((item) => item.id === repoId)!;
        return `https://github.com/${repo.owner}/${repo.name}/actions/runs/${id}`;
      };
      let snapshot = {
        ...base,
        mode: 'live',
        stale: false,
        connectivity: 'online',
        message: undefined,
        runs: base.runs.map((run) => ({
          ...run,
          htmlUrl: link(run.repoId, run.id),
        })),
        repos: many
          ? [
              ...Array.from({ length: 50 }, (_, index) => ({
                ...base.repos[0]!,
                id: `bulk-${index}`,
                name: `bulk-${String(index).padStart(2, '0')}`,
                selected: true,
              })),
              ...base.repos.map((repo) => ({ ...repo, selected: false })),
            ]
          : base.repos,
      };
      return async (cmd, args) => {
        if (cmd === 'snapshot' || cmd === 'refresh_snapshot')
          return structuredClone(snapshot);
        if (cmd === 'select_repos') {
          await new Promise((resolve) => setTimeout(resolve, state.delay));
          if (state.fail) throw state.fail;
          const ids = args?.repoIds as string[];
          snapshot = {
            ...snapshot,
            repos: snapshot.repos.map((repo) => ({
              ...repo,
              selected: ids.includes(repo.id),
            })),
          };
          return structuredClone(snapshot);
        }
        if (cmd === 'connect_token') {
          snapshot = {
            ...snapshot,
            accounts: [
              ...snapshot.accounts,
              { id: 'github-9', login: 'fixture-new', label: 'GitHub · Token' },
            ],
            repos: [
              ...snapshot.repos,
              {
                ...base.repos[0]!,
                id: 'github-9:alpha',
                accountId: 'github-9',
                owner: 'fixture-new',
                name: 'alpha',
                selected: false,
              },
            ],
          };
          return structuredClone(snapshot);
        }
        return null;
      };
    },
    { arg: { fixture, many }, state: { delay: 0, fail: '' } },
  );
  await page.goto('/');
  await expectPage(page, 'overview');
  return mock;
}

/** The repository IDs of every `select_repos` call, in order. */
export const selections = async (page: Page) =>
  (await readCalls(page, 'select_repos')).map((call) => call.args?.repoIds);
