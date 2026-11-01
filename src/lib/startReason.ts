import type { DispatchTarget, Snapshot } from './types';

/** One user-facing reason per cause that keeps a start button disabled. */
export const START_REASONS = {
  manual: 'Kein manueller Start',
  readOnly: 'Kein Schreibzugriff auf dieses Repository',
  offline: 'Offline – Starts sind deaktiviert',
  forbidden: 'Zugriff verweigert – Starts sind deaktiviert',
  running: 'Start läuft …',
  uncertain: 'Startstatus ungeklärt – prüfe die Runs auf GitHub',
} as const;

/** Why no target can start right now; null while starts are possible. */
export function blockedReason(snapshot: Snapshot | null): string | null {
  if (snapshot?.connectivity === 'online') return null;
  return snapshot?.connectivity === 'forbidden'
    ? START_REASONS.forbidden
    : START_REASONS.offline;
}

export interface StartCauses {
  /** The workflow offers no `workflow_dispatch`. */
  manual?: boolean;
  readOnly?: boolean;
  /** Reason from `blockedReason`, if starts are off for every target. */
  blocked?: string | null;
  running?: boolean;
  uncertain?: boolean;
}

/** The causes the snapshot itself sets for one target, before any start. */
export function targetCauses(
  snapshot: Snapshot | null,
  target: DispatchTarget,
): StartCauses {
  const repo = snapshot?.repos.find((item) => item.id === target.repoId);
  const workflow = snapshot?.workflows.find(
    (item) => item.id === target.workflowId && item.repoId === target.repoId,
  );
  return {
    manual: workflow?.dispatch === false,
    readOnly: !!repo && repo.permission !== 'write',
    blocked: blockedReason(snapshot),
  };
}

/** The one reason shown for a disabled start: the most basic cause first. */
export function startReason(causes: StartCauses): string | null {
  if (causes.manual) return START_REASONS.manual;
  if (causes.readOnly) return START_REASONS.readOnly;
  if (causes.blocked) return causes.blocked;
  if (causes.running) return START_REASONS.running;
  if (causes.uncertain) return START_REASONS.uncertain;
  return null;
}

/**
 * Accessible names of a favorite's controls, one rule in every view: „…“
 * marks a control that opens the start dialog. Each names its favorite, so
 * two favorites never share a name.
 */
export const favoriteNames = (label: string) => ({
  open: `Favorit ${label} starten…`,
  quickStart: `Favorit ${label} schnellstarten`,
  remove: `Favorit ${label} entfernen`,
  uncertain: `Startstatus ungeklärt: ${label}`,
});

/**
 * What a target's start control does:
 * - `quick`: a quick start sends at once.
 * - `favorite`: a favorite's „Starten…“ opens its dialog, which also edits
 *   the favorite and releases a lock, so it opens offline too.
 * - `workflow`: a workflow row's „Starten…“ opens the dialog with the
 *   defaults; its row opens the dialog for details anyway.
 */
export type StartControl = 'quick' | 'favorite' | 'workflow';

/** What the controls of one start target may do right now. */
export interface StartGate {
  /** Why the start control is off; null while it may act. */
  reason: string | null;
  canStart: boolean;
  /**
   * The start dialog may open (a row, the gear, a workflow item): only this
   * target's running start closes it; the dialog names every other cause.
   */
  canOpen: boolean;
  /** Why the dialog cannot open; null while it can. */
  openReason: string | null;
  /** The target's favorite may be removed or added (heart, trash). */
  canRemove: boolean;
}

export interface GateState extends StartCauses {
  /** Another favorite change is running. */
  busy?: boolean;
}

/**
 * The one rule for every control of one start target. A quick start is
 * refused for every cause, the uncertain lock included. A workflow row's
 * „Starten…“ is refused for every cause but the lock: the dialog is where
 * a lock is checked and released. Opening the dialog, a favorite's
 * „Starten…“ included, and changing the favorite wait only for this
 * target's running start.
 */
export function startGate(state: GateState, control: StartControl): StartGate {
  const running = !!state.running;
  const openReason = running ? START_REASONS.running : null;
  const reason =
    control === 'quick'
      ? startReason(state)
      : control === 'workflow'
        ? startReason({ ...state, uncertain: false })
        : openReason;
  return {
    reason,
    canStart: !reason,
    canOpen: !running,
    openReason,
    canRemove: !running && !state.busy,
  };
}
