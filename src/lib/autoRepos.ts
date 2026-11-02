import type { Pin, Repo } from './types';

/** Repositories each account shows by its newest pushes (`auto_repos.rs`). */
export const AUTO_REPOS = 10;

const pushTime = (repo: Repo) => {
  const time = repo.pushedAt ? Date.parse(repo.pushedAt) : NaN;
  return Number.isNaN(time) ? -Infinity : time;
};
const lower = (text: string) => text.toLowerCase();
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The browser demo's copy of the native rule: per account the `AUTO_REPOS`
 * repositories with the newest push (a missing one last, ties by
 * `owner/name`), plus every repository of a favorite of that account.
 */
export function autoSelect(repos: Repo[], pins: Pin[]): Repo[] {
  const ranked = [...repos].sort(
    (a, b) =>
      pushTime(b) - pushTime(a) ||
      byName(lower(a.owner), lower(b.owner)) ||
      byName(lower(a.name), lower(b.name)) ||
      byName(a.id, b.id),
  );
  const shown = new Map<string, number>();
  const selected = new Set<string>();
  for (const repo of ranked) {
    const count = shown.get(repo.accountId) ?? 0;
    const pinned = pins.some(
      (pin) => pin.repoId === repo.id && pin.accountId === repo.accountId,
    );
    if (count < AUTO_REPOS) shown.set(repo.accountId, count + 1);
    if (count < AUTO_REPOS || pinned) selected.add(repo.id);
  }
  return repos.map((repo) => ({ ...repo, selected: selected.has(repo.id) }));
}
