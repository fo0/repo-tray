// Repositories the user hid from the lists (ADR-0008): matching, and the
// browser demo's stored copy of the native setting.
import type { PreferenceStorage } from './bridgeTypes';
import { m } from './i18n/index.svelte';
import type { HiddenRepo, Repo } from './types';

/** The demo's hidden repositories; the native shell keeps its own. */
export const HIDDEN_KEY = 'repowatch.demo.hidden.v1';

/** One key per hidden repository of an account. */
export const hiddenKey = (accountId: string, repoId: string) =>
  JSON.stringify([accountId, repoId]);

export function isHidden(
  hidden: readonly HiddenRepo[] | undefined,
  repo: Pick<Repo, 'accountId' | 'id'>,
) {
  return !!hidden?.some(
    (entry) => entry.accountId === repo.accountId && entry.repoId === repo.id,
  );
}

const valid = (entry: unknown): entry is HiddenRepo =>
  !!entry &&
  typeof entry === 'object' &&
  (['accountId', 'repoId', 'owner', 'name'] as const).every(
    (field) => typeof (entry as Record<string, unknown>)[field] === 'string',
  );

/** The stored list; corrupt or unavailable storage hides nothing. */
function readHidden(storage?: PreferenceStorage): HiddenRepo[] {
  try {
    const stored: unknown = JSON.parse(storage?.getItem(HIDDEN_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter(valid) : [];
  } catch {
    return [];
  }
}

function writeHidden(
  storage: PreferenceStorage | undefined,
  hidden: readonly HiddenRepo[],
) {
  try {
    if (hidden.length) storage?.setItem(HIDDEN_KEY, JSON.stringify(hidden));
    else storage?.removeItem(HIDDEN_KEY);
  } catch {
    /* The list still applies for this session. */
  }
}

/**
 * The list after one change, as the native `set_repo_hidden` makes it:
 * hiding needs a known repository, showing one that is not hidden changes
 * nothing.
 */
export function changeHidden(
  repos: readonly Repo[],
  hidden: readonly HiddenRepo[],
  accountId: string,
  repoId: string,
  hide: boolean,
): HiddenRepo[] {
  const rest = hidden.filter(
    (entry) => entry.accountId !== accountId || entry.repoId !== repoId,
  );
  if (!hide) return rest;
  if (rest.length < hidden.length) return [...hidden];
  const repo = repos.find(
    (item) => item.id === repoId && item.accountId === accountId,
  );
  if (!repo) throw new Error(m().settings.hidden.notFound);
  return [...hidden, { accountId, repoId, owner: repo.owner, name: repo.name }];
}

/** The browser demo's hidden repositories, kept in `HIDDEN_KEY`. */
export function demoHidden(storage?: PreferenceStorage) {
  let list = readHidden(storage);
  return {
    get list(): HiddenRepo[] {
      return list;
    },
    /**
     * Applies one change and returns the repositories under `select` (the
     * automatic rule). Repositories opened from the search stay selected,
     * except the one hidden now (`live/hidden.rs`).
     */
    change(
      repos: readonly Repo[],
      accountId: string,
      repoId: string,
      hide: boolean,
      select: (hidden: readonly HiddenRepo[]) => Repo[],
    ): Repo[] {
      const auto = select(list);
      const opened = new Set(
        repos
          .filter((repo, index) => repo.selected && !auto[index]?.selected)
          .filter((repo) => !hide || repo.id !== repoId)
          .map((repo) => repo.id),
      );
      list = changeHidden(repos, list, accountId, repoId, hide);
      writeHidden(storage, list);
      return select(list).map((repo) =>
        opened.has(repo.id) ? { ...repo, selected: true } : repo,
      );
    },
    reset() {
      list = [];
      writeHidden(storage, list);
    },
  };
}
