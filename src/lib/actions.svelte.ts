// Cancelling open runs and loading repositories the search found.
import type { NoticeTone } from './StatusBanners.svelte';
import type { Bridge } from './demo';
import { errorMessage } from './format';
import type { RequestEpoch } from './model';
import { isActive } from './runs';
import type { Run, Snapshot } from './types';

/** The panel state these actions read and change. */
export interface ActionHost {
  readonly viewEpoch: RequestEpoch;
  readonly expandedRepos: Set<string>;
  /** A mutation is running; it answers with its own snapshot. */
  readonly mutating: boolean;
  refreshing: boolean;
  accept(value: Snapshot): void;
  toggleRepo(repoId: string): void;
  showNotice(text: string, tone?: NoticeTone): void;
}

/**
 * Run cancellation and on-demand repositories. A cancel request is sent once;
 * the run stays „wird abgebrochen“ until a snapshot reports it closed, since
 * GitHub's acceptance is not the run's end.
 */
export class Actions {
  /** Runs with an accepted or pending cancel request. */
  cancelling = $state.raw(new Set<number>());
  /** Repositories whose workflows are loading. */
  opening = $state.raw(new Set<string>());
  #host: ActionHost;
  #bridge: Pick<Bridge, 'cancelRun' | 'openRepository'>;

  constructor(
    host: ActionHost,
    bridge: Pick<Bridge, 'cancelRun' | 'openRepository'>,
  ) {
    this.#host = host;
    this.#bridge = bridge;
  }

  /** The run's cancel request is pending or accepted and it is still open. */
  isCancelling = (run: Run) => isActive(run) && this.cancelling.has(run.id);

  cancelRun = async (run: Run) => {
    if (this.cancelling.has(run.id) || !isActive(run)) return;
    this.cancelling = new Set(this.cancelling).add(run.id);
    const ticket = this.#ticket();
    // A changed account cleared the set: its answer belongs to another view.
    const current = () => this.cancelling.has(run.id);
    try {
      const value = await this.#bridge.cancelRun(run.repoId, run.id);
      if (!current()) return;
      this.#accept(ticket, value);
      this.#host.showNotice(`Abbruch von #${run.id} angefordert.`);
    } catch (cause) {
      if (!current()) return;
      this.#drop('cancelling', run.id);
      this.#host.showNotice(errorMessage(cause), 'warning');
    }
  };

  /** Expands the repository at once and loads its workflows into it. */
  openRepository = async (repoId: string) => {
    if (this.opening.has(repoId)) return;
    this.opening = new Set(this.opening).add(repoId);
    if (!this.#host.expandedRepos.has(repoId)) this.#host.toggleRepo(repoId);
    const ticket = this.#ticket();
    try {
      const value = await this.#bridge.openRepository(repoId);
      if (this.opening.has(repoId)) this.#accept(ticket, value);
    } catch (cause) {
      if (!this.opening.has(repoId)) return;
      if (this.#host.expandedRepos.has(repoId)) this.#host.toggleRepo(repoId);
      this.#host.showNotice(errorMessage(cause), 'warning');
    } finally {
      this.#drop('opening', repoId);
    }
  };

  /**
   * The answer is newer than any read in flight, so those reads are cancelled
   * and the refresh button is free again. A running mutation keeps its
   * ticket: it accepts its own, fresher answer (as `Starts.release` does).
   */
  #ticket(): number | null {
    if (this.#host.mutating) return null;
    this.#host.refreshing = false;
    return this.#host.viewEpoch.next();
  }
  #accept(ticket: number | null, value: Snapshot) {
    if (ticket === null || this.#host.viewEpoch.current(ticket))
      this.#host.accept(value);
  }

  /** A new account's view starts without the previous one's requests. */
  clear() {
    this.cancelling = new Set();
    this.opening = new Set();
  }

  #drop<K extends 'cancelling' | 'opening'>(
    key: K,
    value: K extends 'cancelling' ? number : string,
  ) {
    const next = new Set<number | string>(this[key]);
    next.delete(value);
    this[key] = next as never;
  }
}
