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
    const ticket = this.#host.viewEpoch.next();
    try {
      const value = await this.#bridge.cancelRun(run.repoId, run.id);
      if (this.#host.viewEpoch.current(ticket)) this.#host.accept(value);
      this.#host.showNotice(`Abbruch von #${run.id} angefordert.`);
    } catch (cause) {
      this.#drop('cancelling', run.id);
      this.#host.showNotice(errorMessage(cause), 'warning');
    }
  };

  /** Expands the repository at once and loads its workflows into it. */
  openRepository = async (repoId: string) => {
    if (this.opening.has(repoId)) return;
    this.opening = new Set(this.opening).add(repoId);
    if (!this.#host.expandedRepos.has(repoId)) this.#host.toggleRepo(repoId);
    const ticket = this.#host.viewEpoch.next();
    try {
      const value = await this.#bridge.openRepository(repoId);
      if (this.#host.viewEpoch.current(ticket)) this.#host.accept(value);
    } catch (cause) {
      if (this.#host.expandedRepos.has(repoId)) this.#host.toggleRepo(repoId);
      this.#host.showNotice(errorMessage(cause), 'warning');
    } finally {
      this.#drop('opening', repoId);
    }
  };

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
