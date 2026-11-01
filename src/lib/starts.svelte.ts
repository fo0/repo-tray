import type { Bridge } from './demo';
import { errorMessage } from './format';
import { targetKey, validateDispatch } from './model';
import type { Panel } from './panel.svelte';
import type {
  DispatchOutcome,
  DispatchRequest,
  DispatchTarget,
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
  /** The persisted claim of this target, exactly as the snapshot reported it. */
  claimFor = (target: DispatchTarget): UncertainStart | undefined =>
    this.#panel.snapshot?.uncertainStarts?.find(
      (start) => targetKey(start) === targetKey(target),
    );
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
   * Releases exactly this persisted claim after the user checked the runs on
   * GitHub. Never dispatches; rejects with a user-facing error.
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
      // The answer is authoritative; older reads in flight must not win.
      panel.viewEpoch.next();
      panel.refreshing = false;
      panel.accept(value);
      panel.notices.clear(key);
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
      if (outcome.state === 'uncertain') {
        const { accountId, repoId, workflowId, ref } = payload;
        this.#session = new Map(this.#session).set(key, {
          accountId,
          repoId,
          workflowId,
          ref,
        });
      }
      // The snapshot then shows the new run or the persisted claim.
      if (outcome.state !== 'rejected') this.#stale = true;
      result = { outcome };
    } catch (cause) {
      result = { error: errorMessage(cause) };
    }
    // Record the result before freeing the target, so a watching dialog
    // never sees a free target without its result.
    this.settled = new Map(this.settled).set(key, { seq, result });
    const rest = new Map(this.running);
    rest.delete(key);
    this.running = rest;
    if (!this.any && this.#stale) await this.#catchUp();
    return this.#settle(result, payload, options);
  }

  /**
   * One snapshot once the last running start settled: a start that begins
   * later must not discard the run of one that was accepted earlier.
   */
  async #catchUp() {
    const panel = this.#panel;
    this.#stale = false;
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
