import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createDemoBridge, type Bridge } from './demo';
import type {
  DemoScenario,
  DispatchOutcome,
  DispatchRequest,
  Pin,
  Snapshot,
} from './types';

export const native = isTauri();
let storage: Storage | undefined;
try {
  storage = globalThis.localStorage;
} catch {
  /* Private browser modes can deny storage. */
}

export const bridge: Bridge = native
  ? {
      snapshot: () => invoke<Snapshot>('snapshot'),
      refreshSnapshot: () => invoke<Snapshot>('refresh_snapshot'),
      selectRepos: (repoIds: string[]) =>
        invoke<Snapshot>('select_repos', { repoIds }),
      savePin: (pin: Pin) => invoke<Snapshot>('save_pin', { pin }),
      deletePin: (pinId: string) => invoke<Snapshot>('delete_pin', { pinId }),
      dispatchWorkflow: (request: DispatchRequest) =>
        invoke<DispatchOutcome>('dispatch_workflow', { request }),
      setDemoScenario: (scenario: DemoScenario) =>
        invoke<Snapshot>('set_demo_scenario', { scenario }),
      resetDemo: () => invoke<Snapshot>('reset_demo'),
    }
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
