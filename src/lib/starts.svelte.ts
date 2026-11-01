import type { Bridge } from './demo';
import { errorMessage } from './format';
import { targetKey, validateDispatch } from './model';
import type { Panel } from './panel.svelte';
import {
  START_REASONS,
  startGate,
  targetCauses,
  type StartControl,
  type StartGate,
} from './startReason';
import type {
  DispatchOutcome,
  DispatchRequest,
  DispatchTarget,
  Pin,
  Snapshot,
  UncertainStart,
} from './types';

export type StartResult = { outcome: DispatchOutcome } | { error: string };
/** The last result of one target; `seq` identifies the start that produced it. */
export interface SettledStart {
  seq: number;
  result: StartResult;
}
export interface StartOptions {
  /** Names the start in the banner, e.g. a template label. */
  label?: string;
  /** Whether the starting dialog still wants the result; if not, the banner shows it. */
  owner?: () => boolean;
}

/**
 * Workflow starts, tracked per target and independent of any dialog: closing
 * the start dialog neither drops the result nor frees a target that is still
 * starting. An uncertain outcome quarantines its target until the user
 * releases it explicitly; nothing here retries or releases on its own.
 */
export class Starts {
  /** This session's starts with an unknown outcome, by target key. */
  #session = $state.raw(new Map<string, DispatchTarget>());
  /**
   * Every locked target: persisted claims from the snapshot, which survive a
   * restart, plus this session's own uncertain outcomes. Never re-sent.
   */
  claims = $derived.by(() => {
    const all = new Map(this.#session);
    for (const start of this.#panel.snapshot?.uncertainStarts ?? [])
      all.set(targetKey(start), start);
    return all;
  });
  /** Claims whose release is in flight, by target key. */
  releasing = $state.raw(new Set<string>());
  /** Starts in flight: target key → sequence number of the start. */
  running = $state.raw(new Map<string, number>());
  /**
   * Last settled result per target key. A dialog that watched a start shows
   * it, even when another dialog or a quick start owned that start.
   */
  settled = $state.raw(new Map<string, SettledStart>());
  any = $derived(this.running.size > 0);
  #panel: Panel;
  #bridge: Bridge;
  #seq = 0;
  /** A start changed state (a run, a claim) the snapshot does not show yet. */
  #stale = false;

  constructor(panel: Panel, bridge: Bridge) {
    this.#panel = panel;
    this.#bridge = bridge;
  }

  isQuarantined = (target: DispatchTarget) =>
    this.claims.has(targetKey(target));
  /**
   * The claim a release confirms: the persisted one as reported, else the
   * session's own lock without a time (a thrown start, maybe never persisted;
   * the service refuses it while a newer claim exists).
   */
  claimFor = (target: DispatchTarget): UncertainStart | undefined => {
    const key = targetKey(target);
    const persisted = this.#panel.snapshot?.uncertainStarts?.find(
      (start) => targetKey(start) === key,
    );
    const own = this.#session.get(key);
    return persisted ?? (own && { ...own, claimedAt: null });
  };
  /** Locked refs of one repository or workflow, for the rows' warning markers. */
  uncertainRefs = (scope: {
    accountId: string;
    repoId: string;
    workflowId?: number;
  }) =>
    [...this.claims.values()]
      .filter(
        (claim) =>
          claim.accountId === scope.accountId &&
          claim.repoId === scope.repoId &&
          (scope.workflowId === undefined ||
            claim.workflowId === scope.workflowId),
      )
      .map((claim) => claim.ref);
  /** What a target's controls may do, by the one rule of `startGate`. */
  gate = (target: DispatchTarget, control: StartControl = 'workflow') =>
    startGate(
      {
        ...targetCauses(this.#panel.snapshot, target),
        running: this.isRunning(target),
        uncertain: this.isQuarantined(target),
        busy: this.#panel.pinsBusy,
      },
      control,
    );
  favoriteGate = (pin: Pin): StartGate =>
    this.gate(pin, pin.quickStart ? 'quick' : 'favorite');
  isReleasing = (target: DispatchTarget) =>
    this.releasing.has(targetKey(target));
  isRunning = (target: DispatchTarget) => this.running.has(targetKey(target));
  /** Sequence number of the start running for this target, if any. */
  runningSeq = (target: DispatchTarget) => this.running.get(targetKey(target));
  settledFor = (target: DispatchTarget) => this.settled.get(targetKey(target));

  /** Demo reset only: the demo bridge drops its claims at the same time. */
  clearQuarantine() {
    this.#session = new Map();
  }

  /**
   * Drops session locks of accounts a snapshot no longer lists, as the
   * service deletes a disconnected account's claims (its confirmation warns);
   * a reconnect must not bring back a lock nothing can release.
   */
  retainAccounts(snapshot: Snapshot) {
    const ids = new Set(snapshot.accounts.map((account) => account.id));
    const kept = [...this.#session].filter(([, target]) =>
      ids.has(target.accountId),
    );
    if (kept.length !== this.#session.size) this.#session = new Map(kept);
  }

  /**
   * Releases exactly this claim after the user checked the runs on GitHub. An
   * untimed session lock never releases a timed claim the service still holds:
   * that refusal keeps the lock and refreshes. Never dispatches.
   */
  async release(start: UncertainStart) {
    const panel = this.#panel;
    const key = targetKey(start);
    if (this.releasing.has(key)) return;
    this.releasing = new Set([...this.releasing, key]);
    try {
      const value = await this.#bridge.releaseUncertainStart(start);
      const session = new Map(this.#session);
      session.delete(key);
      this.#session = session;
      // The answer is authoritative; older reads in flight must not win. A
      // running mutation keeps its ticket: it reports and accepts its own
      // answer, which at worst shows the claim again until the next snapshot.
      if (!panel.mutating) {
        panel.viewEpoch.next();
        panel.refreshing = false;
      }
      panel.accept(value);
      panel.notices.clear(key);
    } catch (cause) {
      // A refusal (e.g. a newer claim) means the snapshot is outdated: show
      // the current claim, so a retry does not fail the same way. A running
      // mutation brings a fresh snapshot anyway and must not be cancelled.
      if (!panel.mutating) void panel.refresh();
      throw cause;
    } finally {
      const rest = new Set(this.releasing);
      rest.delete(key);
      this.releasing = rest;
    }
  }

  /**
   * Starts a workflow once per target. The result goes to `owner` while it
   * still wants it and to the panel banner otherwise; resolves to null then.
   */
  async dispatch(
    payload: DispatchRequest,
    options: StartOptions = {},
  ): Promise<StartResult | null> {
    const panel = this.#panel;
    const key = targetKey(payload);
    if (!panel.snapshot || this.running.has(key)) return null;
    // A locked target is never sent again, whatever the caller checked.
    if (this.claims.has(key))
      return this.#settle({ error: START_REASONS.uncertain }, payload, options);
    const invalid = validateDispatch(panel.snapshot, payload);
    if (invalid) return this.#settle({ error: invalid }, payload, options);
    const seq = ++this.#seq;
    this.running = new Map(this.running).set(key, seq);
    panel.error = '';
    // Only this target's earlier result goes; other starts keep their banner.
    panel.notices.clear(key);
    let result: StartResult;
    try {
      const outcome = await this.#bridge.dispatchWorkflow(payload);
      if (outcome.state === 'uncertain') this.#lock(payload);
      result = { outcome };
    } catch (cause) {
      // A thrown call is uncertain from the panel's view: the service may
      // have persisted the claim and sent the request before the answer was
      // lost, e.g. to a crashed task or a broken IPC channel. Locked like an
      // uncertain outcome, the target never turns startable while the
      // catch-up read is pending, and only an explicit release frees it.
      this.#lock(payload);
      result = { error: errorMessage(cause) };
    }
    // The snapshot then shows the new run or the persisted claim; even a
    // rejected or failed start can leave a claim the service could not remove.
    this.#stale = true;
    // Record the result before freeing the target, so a watching dialog
    // never sees a free target without its result.
    this.settled = new Map(this.settled).set(key, { seq, result });
    const rest = new Map(this.running);
    rest.delete(key);
    this.running = rest;
    if (!this.any && this.#stale) await this.#catchUp();
    return this.#settle(result, payload, options);
  }

  /** Quarantines a target whose start has an unknown outcome. */
  #lock({ accountId, repoId, workflowId, ref }: DispatchTarget) {
    // An account removed meanwhile took its claims along (see retainAccounts).
    if (!this.#panel.snapshot?.accounts.some((item) => item.id === accountId))
      return;
    this.#session = new Map(this.#session).set(
      targetKey({ accountId, repoId, workflowId, ref }),
      { accountId, repoId, workflowId, ref },
    );
  }

  /**
   * One snapshot once the last running start settled: a start that begins
   * later must not discard the run of one that was accepted earlier.
   */
  async #catchUp() {
    const panel = this.#panel;
    this.#stale = false;
    // A running mutation answers with a fresh snapshot of its own; a read
    // now would only cancel it.
    if (panel.mutating) return;
    // Cancels older reads only: no mutation holds a ticket right now, and
    // one that starts meanwhile cancels this read instead.
    const ticket = panel.viewEpoch.next();
    panel.refreshing = false;
    try {
      const value = await this.#bridge.snapshot();
      if (panel.viewEpoch.current(ticket)) panel.accept(value);
    } catch {
      /* The next pushed snapshot shows the new run. */
    }
  }

  #settle(
    result: StartResult,
    payload: DispatchRequest,
    options: StartOptions,
  ): StartResult | null {
    if (options.owner?.()) return result;
    const panel = this.#panel;
    const key = targetKey(payload);
    const name =
      options.label ??
      panel.snapshot?.workflows.find(
        (item) =>
          item.id === payload.workflowId && item.repoId === payload.repoId,
      )?.name ??
      'Workflow';
    if ('error' in result) {
      panel.notices.show({
        key,
        text: `${name}: ${result.error}`,
        tone: 'danger',
      });
      return null;
    }
    const { state, message, runId } = result.outcome;
    const text =
      state === 'rejected'
        ? `${name}: Start abgelehnt. ${message}`
        : `${name}: ${message}`;
    const tone =
      state === 'accepted'
        ? 'subtle'
        : state === 'uncertain'
          ? 'warning'
          : 'danger';
    panel.notices.show({
      key,
      text,
      tone,
      runId,
      accountId: payload.accountId,
    });
    return null;
  }
}
