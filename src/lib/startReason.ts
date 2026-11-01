import type { Snapshot } from './types';

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

/** The one reason shown for a disabled start: the most basic cause first. */
export function startReason(causes: StartCauses): string | null {
  if (causes.manual) return START_REASONS.manual;
  if (causes.readOnly) return START_REASONS.readOnly;
  if (causes.blocked) return causes.blocked;
  if (causes.running) return START_REASONS.running;
  if (causes.uncertain) return START_REASONS.uncertain;
  return null;
}
