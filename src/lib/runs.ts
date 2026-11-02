// Run lists, status and duration for the activity and repository views.
import type { IconName } from './Icon.svelte';
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
        status: repositoryStatus(runs, latest),
        recent: recentRuns({ runs }, repo.id),
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

/** A repository's name without its owner, as run rows show it. */
export const shortRepo = (repo: string) =>
  repo.slice(repo.lastIndexOf('/') + 1);

/**
 * How a run row is named, repository first: every repository may call its
 * workflow „Release“, so the repository tells the rows apart, e.g.
 * `example-org/runner-tools-demo · Runner health #8403`.
 */
export const runLabel = (run: Run, repo: string) =>
  `${repo} · ${run.name} #${run.id}`;

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

/**
 * How a run reads at a glance: one colour and one icon per class, in the
 * same classes as `statusLabel`. The service already folds GitHub's
 * timed-out, startup-failure and action-required outcomes into `failure`, and
 * skipped, neutral and stale ones into `cancelled`.
 */
export type RunTone = 'run' | 'wait' | 'queue' | 'ok' | 'fail' | 'cancel';

export function runTone(run: Run): RunTone {
  if (run.status === 'in_progress') return 'run';
  if (run.status === 'waiting') return 'wait';
  if (run.status === 'queued') return 'queue';
  if (run.conclusion === 'success') return 'ok';
  return run.conclusion === 'failure' ? 'fail' : 'cancel';
}

/** The status icon of each tone, as the Verlauf rows draw it. */
export const TONE_ICON: Record<RunTone, IconName> = {
  run: 'activity',
  wait: 'pause',
  queue: 'clock',
  ok: 'check',
  fail: 'close',
  cancel: 'close',
};

/**
 * The status line of a repository row. Open runs come first, so a running
 * build is never hidden behind a later update: more than one reads
 * „2 aktiv“, one names its own status; otherwise the latest run's status.
 */
export function repositoryStatus(
  runs: readonly Run[],
  latest: Run | undefined,
): { tone: RunTone; label: string } | null {
  const active = runs.filter(isActive);
  if (active.length > 1)
    return {
      tone: active.some((run) => run.status === 'in_progress')
        ? 'run'
        : runTone(active[0]!),
      label: `${active.length} aktiv`,
    };
  const run = active[0] ?? latest;
  return run ? { tone: runTone(run), label: statusLabel(run) } : null;
}

/** Cells of the run strip: how many runs each repository row shows. */
export const STRIP_CELLS = 8;

/**
 * The run strip of one repository: its last `n` runs by start time, oldest
 * first and newest last, padded at the start with `null` while it has fewer.
 */
export function recentRuns(
  snapshot: Pick<Snapshot, 'runs'>,
  repoId: string,
  n = STRIP_CELLS,
): (Run | null)[] {
  const recent = snapshot.runs
    .filter((run) => run.repoId === repoId)
    .sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id,
    )
    .slice(0, n)
    .reverse();
  return [...Array<null>(Math.max(0, n - recent.length)).fill(null), ...recent];
}

/** Spoken tone counts, singular and plural, in the order the summary names them. */
const TONE_WORDS: [RunTone, one: string, many: string][] = [
  ['ok', 'erfolgreich', 'erfolgreich'],
  ['fail', 'fehlgeschlagen', 'fehlgeschlagen'],
  ['cancel', 'abgebrochen', 'abgebrochen'],
  ['run', 'läuft', 'laufen'],
  ['wait', 'wartet', 'warten'],
  ['queue', 'in Warteschlange', 'in Warteschlange'],
];

/**
 * What a run strip shows, in words: the strip is colour only, e.g.
 * „Letzte 8 Runs: 6 erfolgreich, 1 fehlgeschlagen, 1 läuft“.
 */
export function recentSummary(cells: readonly (Run | null)[]): string {
  const runs = cells.filter((run): run is Run => run !== null);
  const counts = new Map<RunTone, number>();
  for (const run of runs)
    counts.set(runTone(run), (counts.get(runTone(run)) ?? 0) + 1);
  const words = TONE_WORDS.filter(([tone]) => counts.has(tone));
  if (runs.length === 0) return 'Noch keine Runs';
  if (runs.length === 1) return `Letzter Run: ${words[0]![1]}`;
  return `Letzte ${runs.length} Runs: ${words
    .map(([tone, one, many]) => {
      const count = counts.get(tone)!;
      return `${count} ${count === 1 ? one : many}`;
    })
    .join(', ')}`;
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
