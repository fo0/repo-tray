import { clockTime, errorMessage } from './format';
import { call, channel } from './ipc';
import type { DownloadProgress, UpdateInfo } from './types';
import type { UpdatePhase } from './updates';

const BUSY_PHASES: UpdatePhase[] = [
  'checking',
  'downloading',
  'verifying',
  'installing',
];

/**
 * In-app update flow; only the native shell reaches the updater commands.
 * State is read-only from outside: only `check`, `download` and `install`
 * change it.
 */
export class Updater {
  #info = $state<UpdateInfo | null>(null);
  #phase = $state<UpdatePhase>('idle');
  #progress = $state<DownloadProgress>({
    downloaded: 0,
    total: null,
    stage: 'downloading',
  });
  #message = $state('');
  #checkedAt = $state('');
  #busy = $derived(BUSY_PHASES.includes(this.#phase));
  #enabled: boolean;

  constructor(enabled: boolean) {
    this.#enabled = enabled;
  }

  get info() {
    return this.#info;
  }
  get phase() {
    return this.#phase;
  }
  get progress() {
    return this.#progress;
  }
  get message() {
    return this.#message;
  }
  get checkedAt() {
    return this.#checkedAt;
  }
  get busy() {
    return this.#busy;
  }

  check = async (silent = false) => {
    if (!this.#enabled || this.#busy || this.#phase === 'ready') return;
    this.#phase = 'checking';
    this.#message = '';
    try {
      this.#info = await call('check_update');
      this.#checkedAt = clockTime();
      this.#phase = this.#info ? 'available' : 'current';
    } catch (cause) {
      this.#info = null;
      this.#phase = 'idle';
      if (!silent) this.#message = errorMessage(cause);
    }
  };

  download = async () => {
    if (this.#busy || !this.#info || this.#phase === 'ready') return;
    this.#phase = 'downloading';
    this.#message = '';
    this.#progress = { downloaded: 0, total: null, stage: 'downloading' };
    const onProgress = channel<DownloadProgress>((progress) => {
      if (this.#phase !== 'downloading' && this.#phase !== 'verifying') return;
      this.#phase = progress.stage;
      if (progress.stage === 'downloading') this.#progress = progress;
    });
    try {
      await call('download_update', { onProgress });
      this.#phase = 'ready';
    } catch (cause) {
      this.#phase = 'available';
      this.#message = errorMessage(cause);
    }
  };

  install = async () => {
    if (this.#phase !== 'ready') return;
    this.#phase = 'installing';
    this.#message = '';
    try {
      await call('install_update');
    } catch (cause) {
      this.#phase = 'ready';
      this.#message = errorMessage(cause);
    }
  };
}
