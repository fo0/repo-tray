import { m } from './i18n/index.svelte';
import type { DispatchTarget, Snapshot } from './types';

/**
 * One user-facing reason per cause that keeps a start button disabled, in
 * the language in effect; read at call time, never kept.
 */
export const startReasons = () => m().dispatch.reasons;

/** Why no target can start right now; null while starts are possible. */
export function blockedReason(snapshot: Snapshot | null): string | null {
  if (snapshot?.connectivity === 'online') return null;
  return snapshot?.connectivity === 'forbidden'
    ? startReasons().forbidden
    : startReasons().offline;
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
  const reasons = startReasons();
  if (causes.manual) return reasons.manual;
  if (causes.readOnly) return reasons.readOnly;
  if (causes.blocked) return causes.blocked;
  if (causes.running) return reasons.running;
  if (causes.uncertain) return reasons.uncertain;
  return null;
}

/**
 * Accessible names of a favorite's controls, one rule in every view: they
 * lead with the repository (its name without the owner), as the favorite's
 * row does, and „…“ marks a control that opens the start dialog while
 * „jetzt“ marks the one that sends at once. Each names its favorite, so two
 * favorites never share a name.
 */
export const favoriteNames = (repo: string, label: string) => {
  const name = `${repo} · ${label}`;
  const names = m().favorites.names;
  return {
    open: names.open(name),
    start: names.start(name),
    edit: names.edit(name),
    remove: names.remove(name),
    uncertain: names.uncertain(name),
  };
};

/**
 * What a target's start control does:
 * - `favorite`: a favorite's start sends at once when its stored request is
 *   complete, else it opens the start dialog to complete it.
 * - `workflow`: a workflow row's „Starten…“ opens the dialog with the
 *   defaults; its row opens the dialog for details anyway.
 */
export type StartControl = 'favorite' | 'workflow';

/** What the controls of one start target may do right now. */
export interface StartGate {
  /** Why the start control is off; null while it may act. */
  reason: string | null;
  canStart: boolean;
  /**
   * The start dialog may open (a row, the settings, a workflow item): only this
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
 * The one rule for every control of one start target. A favorite's start
 * may send at once, so it is refused for every cause, the uncertain lock
 * included. A workflow row's „Starten…“ is refused for every cause but the
 * lock: the dialog is where a lock is checked and released. Opening the
 * dialog (a favorite's name or settings included) and changing the favorite
 * wait only for this target's running start.
 */
export function startGate(state: GateState, control: StartControl): StartGate {
  const running = !!state.running;
  const openReason = running ? startReasons().running : null;
  const reason =
    control === 'favorite'
      ? startReason(state)
      : startReason({ ...state, uncertain: false });
  return {
    reason,
    canStart: !reason,
    canOpen: !running,
    openReason,
    canRemove: !running && !state.busy,
  };
}
