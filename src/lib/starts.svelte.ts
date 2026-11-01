import type { Bridge } from './demo';
import { errorMessage } from './format';
import { targetKey, validateDispatch } from './model';
import type { Panel } from './panel.svelte';
import type { DispatchOutcome, DispatchRequest, DispatchTarget } from './types';

export type StartResult = { outcome: DispatchOutcome } | { error: string };
export interface StartOptions {
  /** Names the start in the banner, e.g. a template label. */
  label?: string;
  /** Whether the starting dialog still wants the result; if not, the banner shows it. */
  owner?: () => boolean;
}

/**
 * Workflow starts, tracked per target and independent of any dialog: closing
 * the start dialog neither drops the result nor frees a target that is still
 * starting. An uncertain outcome quarantines its target; nothing here retries.
 */
export class Starts {
  /** Targets whose start has an unknown outcome; never re-sent. */
  quarantined = $state.raw(new Set<string>());
  /** Starts in flight by target key. */
  running = $state.raw(new Set<string>());
  any = $derived(this.running.size > 0);
  #panel: Panel;
  #bridge: Bridge;

  constructor(panel: Panel, bridge: Bridge) {
    this.#panel = panel;
    this.#bridge = bridge;
  }

  isQuarantined = (target: DispatchTarget) =>
    this.quarantined.has(targetKey(target));
  isRunning = (target: DispatchTarget) => this.running.has(targetKey(target));

  /** Demo reset only: the demo bridge drops its claims at the same time. */
  clearQuarantine() {
    this.quarantined = new Set();
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
    this.running = new Set([...this.running, key]);
    const viewTicket = panel.viewEpoch.next();
    panel.refreshing = false;
    panel.error = '';
    panel.notice = null;
    let result: StartResult;
    try {
      const outcome = await this.#bridge.dispatchWorkflow(payload);
      if (outcome.state === 'uncertain')
        this.quarantined = new Set([...this.quarantined, key]);
      if (outcome.state === 'accepted') {
        try {
          const value = await this.#bridge.snapshot();
          if (panel.viewEpoch.current(viewTicket)) panel.accept(value);
        } catch {
          /* The next pushed snapshot shows the new run. */
        }
      }
      result = { outcome };
    } catch (cause) {
      result = { error: errorMessage(cause) };
    } finally {
      const rest = new Set(this.running);
      rest.delete(key);
      this.running = rest;
    }
    return this.#settle(result, payload, options);
  }

  #settle(
    result: StartResult,
    payload: DispatchRequest,
    options: StartOptions,
  ): StartResult | null {
    if (options.owner?.()) return result;
    const panel = this.#panel;
    const name =
      options.label ??
      panel.snapshot?.workflows.find(
        (item) =>
          item.id === payload.workflowId && item.repoId === payload.repoId,
      )?.name ??
      'Workflow';
    if ('error' in result) {
      panel.error = `${name}: ${result.error}`;
      return null;
    }
    const { state, message, runId } = result.outcome;
    if (state === 'accepted')
      panel.showNotice(`${name}: ${message}`, 'subtle', runId);
    else if (state === 'uncertain')
      panel.showNotice(`${name}: ${message}`, 'warning');
    else panel.showNotice(`${name}: Start abgelehnt. ${message}`, 'danger');
    return null;
  }
}
