import type {
  DispatchRequest,
  InputValue,
  Pin,
  Repo,
  Run,
  Snapshot,
  Workflow,
} from './types';

export type ActivityFilter = 'all' | 'active' | 'failed' | 'recent';
export const fullRepo = (repo: Repo) => `${repo.owner}/${repo.name}`;
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
export const isSecretName = (name: string) =>
  /(?:token|secret|password|credential|private[_-]?key|api[_-]?key)/i.test(
    name,
  );

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

export function groupedRuns(
  snapshot: Snapshot,
  accountId: string,
  query: string,
  filter: ActivityFilter,
) {
  const visible = visibleRuns(snapshot, accountId, query, filter);
  const active = visibleRuns(snapshot, accountId, query, 'active');
  return snapshot.repos
    .flatMap((repo) => {
      const runs = visible.filter((run) => run.repoId === repo.id);
      if (!runs.length) return [];
      return [
        {
          repo,
          runs,
          activeCount: active.filter((run) => run.repoId === repo.id).length,
        },
      ];
    })
    .sort(
      (a, b) =>
        b.activeCount - a.activeCount ||
        Date.parse(b.runs[0].createdAt) - Date.parse(a.runs[0].createdAt) ||
        fullRepo(a.repo).localeCompare(fullRepo(b.repo)),
    );
}

export function defaultInputs(workflow: Workflow): Record<string, InputValue> {
  return Object.fromEntries(
    workflow.inputs.map((input) => [
      input.name,
      input.default ?? (input.type === 'boolean' ? false : ''),
    ]),
  );
}

export function validateDispatch(
  snapshot: Snapshot,
  request: DispatchRequest,
): string | null {
  const repo = snapshot.repos.find((item) => item.id === request.repoId);
  if (
    !snapshot.accounts.some((account) => account.id === request.accountId) ||
    !repo ||
    repo.accountId !== request.accountId
  )
    return 'Account und Repository passen nicht zusammen.';
  if (!repo.selected)
    return 'Wähle dieses Repository zuerst in den Einstellungen aus.';
  if (repo.permission !== 'write')
    return 'Für dieses Repository fehlt die Schreibberechtigung.';
  const workflow = snapshot.workflows.find(
    (item) => item.id === request.workflowId && item.repoId === repo.id,
  );
  if (!workflow || !workflow.dispatch)
    return 'Dieser Workflow bietet keinen manuellen Start auf dem Standardbranch an.';
  if (!workflow.refs.includes(repo.defaultBranch))
    return 'workflow_dispatch ist auf dem Standardbranch nicht verfügbar.';
  if (!workflow.refs.includes(request.ref))
    return 'Dieser Branch oder Tag ist nicht verfügbar.';
  if (!request.requestId.trim())
    return 'Die Anfrage benötigt eine eindeutige ID.';
  if (
    Object.keys(request.inputs).some(
      (name) => !workflow.inputs.some((input) => input.name === name),
    )
  )
    return 'Unbekannte Workflow-Eingabe.';
  for (const input of workflow.inputs) {
    const value = request.inputs[input.name];
    const absent =
      value === undefined || (typeof value === 'string' && !value.trim());
    if (absent && input.required) return `${input.label} ist erforderlich.`;
    if (absent) continue;
    if (input.type === 'boolean' && typeof value !== 'boolean')
      return `${input.label} muss ein Wahrheitswert sein.`;
    if (
      input.type === 'number' &&
      (typeof value !== 'number' || !Number.isFinite(value))
    )
      return `${input.label} muss eine endliche Zahl sein.`;
    if (
      ['string', 'choice', 'environment'].includes(input.type) &&
      typeof value !== 'string'
    )
      return `${input.label} muss Text sein.`;
    if (
      ['choice', 'environment'].includes(input.type) &&
      !input.options.includes(String(value))
    )
      return `${input.label}: Wähle einen verfügbaren Wert.`;
  }
  return null;
}

export function safePin(snapshot: Snapshot, pin: Pin): Pin {
  const error = validateDispatch(snapshot, {
    ...pin,
    requestId: 'pin-validation',
  });
  if (error) throw new Error(error);
  if (!pin.label.trim() || !pin.id.trim())
    throw new Error('Die Vorlage benötigt einen Namen.');
  if (Object.keys(pin.inputs).some(isSecretName))
    throw new Error('Geheime Eingaben werden nicht in Vorlagen gespeichert.');
  return {
    id: pin.id,
    label: pin.label.trim(),
    accountId: pin.accountId,
    repoId: pin.repoId,
    workflowId: pin.workflowId,
    ref: pin.ref,
    inputs: { ...pin.inputs },
    quickStart: pin.quickStart === true,
  };
}

export function safeGitHubUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    if (
      !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+\/?$/.test(
        url.pathname,
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function duration(run: Run): string {
  const seconds = Math.max(
    0,
    Math.round((Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 1000),
  );
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
    : `${seconds}s`;
}

/** Invalidate responses when their UI context has changed or a dialog has closed. */
export class RequestEpoch {
  private value = 0;
  next() {
    return ++this.value;
  }
  current(ticket: number) {
    return ticket === this.value;
  }
  invalidate() {
    this.value++;
  }
}
