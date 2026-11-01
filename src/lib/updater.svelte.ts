import { Channel, invoke } from '@tauri-apps/api/core';
import { clockTime, errorMessage } from './format';
import type { UpdateInfo, UpdatePhase, UpdateProgress } from './updates';

const BUSY_PHASES: UpdatePhase[] = [
  'checking',
  'downloading',
  'verifying',
  'installing',
];

/** In-app update flow; only the native shell reaches the updater commands. */
export class Updater {
  info = $state<UpdateInfo | null>(null);
  phase = $state<UpdatePhase>('idle');
  progress = $state<UpdateProgress>({
    downloaded: 0,
    total: null,
    stage: 'downloading',
  });
  message = $state('');
  checkedAt = $state('');
  busy = $derived(BUSY_PHASES.includes(this.phase));
  #enabled: boolean;

  constructor(enabled: boolean) {
    this.#enabled = enabled;
  }

  check = async (silent = false) => {
    if (!this.#enabled || this.busy || this.phase === 'ready') return;
    this.phase = 'checking';
    this.message = '';
    try {
      this.info = await invoke<UpdateInfo | null>('check_update');
      this.checkedAt = clockTime();
      this.phase = this.info ? 'available' : 'current';
    } catch (cause) {
      this.info = null;
      this.phase = 'idle';
      if (!silent) this.message = errorMessage(cause);
    }
  };

  download = async () => {
    if (this.busy || !this.info || this.phase === 'ready') return;
    this.phase = 'downloading';
    this.message = '';
    this.progress = { downloaded: 0, total: null, stage: 'downloading' };
    const onProgress = new Channel<UpdateProgress>();
    onProgress.onmessage = (progress) => {
      if (this.phase !== 'downloading' && this.phase !== 'verifying') return;
      this.phase = progress.stage;
      if (progress.stage === 'downloading') this.progress = progress;
    };
    try {
      await invoke('download_update', { onProgress });
      this.phase = 'ready';
    } catch (cause) {
      this.phase = 'available';
      this.message = errorMessage(cause);
    }
  };

  install = async () => {
    if (this.phase !== 'ready') return;
    this.phase = 'installing';
    this.message = '';
    try {
      await invoke('install_update');
    } catch (cause) {
      this.phase = 'ready';
      this.message = errorMessage(cause);
    }
  };
}
