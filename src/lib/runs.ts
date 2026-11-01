// Run lists, status and duration for the activity and repository views.
import { fullRepo } from './model';
import type { Run, Snapshot } from './types';

export type ActivityFilter = 'all' | 'active' | 'failed' | 'recent';
export const isActive = (run: Run) => run.status !== 'completed';
export const HISTORY_LIMIT = 50;

/** The repository browser includes selected repos even before their first run. */
export function repositoryActivity(
  snapshot: Snapshot,
  accountId: string,
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  return snapshot.repos
    .filter(
      (repo) => repo.selected && (!accountId || repo.accountId === accountId),
    )
    .map((repo) => {
      const runs = snapshot.runs.filter((run) => run.repoId === repo.id);
      const latest = [...runs].sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      )[0];
      const workflows = snapshot.workflows.filter(
        (workflow) =>
          workflow.repoId === repo.id &&
          (!needle ||
            `${fullRepo(repo)} ${workflow.name}`
              .toLocaleLowerCase()
              .includes(needle)),
      );
      return {
        repo,
        workflows,
        latest,
        activeCount: runs.filter(isActive).length,
      };
    })
    .filter(
      ({ repo, workflows }) =>
        !needle ||
        fullRepo(repo).toLocaleLowerCase().includes(needle) ||
        workflows.length > 0,
    )
    .sort(
      (a, b) =>
        (b.latest ? Date.parse(b.latest.updatedAt) : 0) -
          (a.latest ? Date.parse(a.latest.updatedAt) : 0) ||
        fullRepo(a.repo).localeCompare(fullRepo(b.repo)),
    );
}

/** Keep every open run visible, with a bounded chronological completed history. */
export function historyRuns(
  snapshot: Snapshot,
  accountId: string,
  query: string,
  filter: ActivityFilter,
) {
  let completed = 0;
  return visibleRuns(snapshot, accountId, query, filter).filter(
    (run) => isActive(run) || ++completed <= HISTORY_LIMIT,
  );
}

export function statusLabel(run: Run): string {
  if (run.status === 'in_progress') return 'Läuft';
  if (run.status === 'queued') return 'In Warteschlange';
  if (run.status === 'waiting') return 'Wartet';
  return {
    success: 'Erfolgreich',
    failure: 'Fehlgeschlagen',
    cancelled: 'Abgebrochen',
  }[run.conclusion ?? 'cancelled'];
}

export function visibleRuns(
  snapshot: Snapshot,
  accountId: string,
  query: string,
  filter: ActivityFilter,
): Run[] {
  const needle = query.trim().toLocaleLowerCase();
  const repos = new Map(
    snapshot.repos
      .filter((r) => r.selected && (!accountId || r.accountId === accountId))
      .map((r) => [r.id, r]),
  );
  return snapshot.runs
    .filter((run) => {
      const repo = repos.get(run.repoId);
      if (
        !repo ||
        (filter === 'active' && !isActive(run)) ||
        (filter === 'failed' && run.conclusion !== 'failure')
      )
        return false;
      if (filter === 'recent' && isActive(run)) return false;
      return (
        !needle ||
        `${fullRepo(repo)} ${run.name} ${run.branch}`
          .toLocaleLowerCase()
          .includes(needle)
      );
    })
    .sort(
      (a, b) =>
        Number(isActive(b)) - Number(isActive(a)) ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
}

/** Run time as `m:ss min` (German UI), e.g. `0:42 min` or `12:05 min`. */
export function duration(run: Run): string {
  const seconds = Math.max(
    0,
    Math.round((Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 1000),
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} min`;
}
