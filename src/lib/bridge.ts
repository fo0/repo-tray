import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createDemoBridge, type Bridge, type DemoControls } from './demo';
import { call } from './ipc';
import type { Snapshot } from './types';

export const native = isTauri();
let storage: Storage | undefined;
try {
  storage = globalThis.localStorage;
} catch {
  /* Private browser modes can deny storage. */
}

/** Native commands; the shell has no demo scenario or reset command. */
const nativeBridge: Bridge = {
  snapshot: () => call('snapshot'),
  refreshSnapshot: () => call('refresh_snapshot'),
  selectRepos: (repoIds) => call('select_repos', { repoIds }),
  savePin: (pin) => call('save_pin', { pin }),
  deletePin: (pinId) => call('delete_pin', { pinId }),
  dispatchWorkflow: (request) => call('dispatch_workflow', { request }),
  releaseUncertainStart: (start) => call('release_uncertain_start', { start }),
};

export const bridge: Bridge & Partial<DemoControls> = native
  ? nativeBridge
  : createDemoBridge(storage);

/** Native owns polling; browser polls its local simulation without network traffic. */
export async function observeSnapshots(
  callback: (snapshot: Snapshot) => void,
): Promise<() => void> {
  if (native) {
    try {
      return await listen<Snapshot>('repotray:snapshot', (event) =>
        callback(event.payload),
      );
    } catch {
      /* A shell without event permissions can still read native snapshots. */
    }
  }
  const timer = setInterval(() => {
    void bridge
      .snapshot()
      .then(callback)
      .catch(() => {
        /* Explicit refresh reports connection errors. */
      });
  }, 1000);
  return () => clearInterval(timer);
}
