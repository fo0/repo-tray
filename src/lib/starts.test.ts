import { describe, expect, it } from 'vitest';
import { createDemoBridge, type Bridge } from './demo';
import { Panel } from './panel.svelte';
import { START_REASONS } from './startReason';
import type { DispatchRequest, Snapshot } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
const flush = () => new Promise((done) => setTimeout(done, 0));
const request: DispatchRequest = {
  accountId: 'demo-personal',
  repoId: 'demo-personal-kit',
  workflowId: 101,
  ref: 'main',
  inputs: { target: 'windows-x64', version: '0.1.0', dry_run: true },
  requestId: 'request-a',
};
const claim = {
  accountId: request.accountId,
  repoId: request.repoId,
  workflowId: request.workflowId,
  ref: request.ref,
  claimedAt: '2026-11-01T08:00:00Z',
};
/** Another target of the same workflow, so starts and claims do not collide. */
const other = { ...request, ref: 'develop', requestId: 'request-b' };

/** A browser-demo panel whose bridge calls the test can override. */
async function setup(overrides: Partial<Bridge> = {}) {
  const bridge = { ...createDemoBridge(undefined, 0), ...overrides };
  let push: (snapshot: Snapshot) => void = () => {};
  const panel = new Panel({
    bridge,
    native: false,
    observe: async (callback) => {
      push = callback;
      return () => {};
    },
  });
  panel.load();
  await flush();
  return { panel, bridge, push: (value: Snapshot) => push(value) };
}
const texts = (panel: Panel) => panel.notices.items.map((item) => item.text);

describe('Starts and running mutations', () => {
  it('a catch-up after a start never cancels a favorite removal in flight', async () => {
    const deletion = deferred<Snapshot>();
    let reads = 0;
    const { panel, bridge } = await setup({
      deletePin: () => deletion.promise,
      dispatchWorkflow: async () => ({
        state: 'accepted',
        runId: 9001,
        message: 'Angenommen.',
      }),
    });
    const snapshot = bridge.snapshot;
    bridge.snapshot = () => (reads++, snapshot());
    const loaded = panel.snapshot!;
    const removal = panel.favorites.remove(loaded.pins[0]!.id);
    await panel.starts.dispatch(other, { label: 'Checks' });
    const after = { ...loaded, pins: [] };
    deletion.resolve(after);
    await removal;
    expect(panel.snapshot).toBe(after);
    expect(texts(panel)).toContain('Favorit „Windows build“ entfernt.');
    // The removal's own answer is the fresh snapshot: no extra read.
    expect(reads).toBe(0);
  });

  it('a release never cancels a favorite removal in flight', async () => {
    const deletion = deferred<Snapshot>();
    const { panel, push } = await setup({
      deletePin: () => deletion.promise,
      releaseUncertainStart: async () => ({
        ...panel.snapshot!,
        uncertainStarts: [],
      }),
    });
    push({ ...panel.snapshot!, uncertainStarts: [claim] });
    const loaded = panel.snapshot!;
    const removal = panel.favorites.remove(loaded.pins[0]!.id);
    await panel.starts.release(claim);
    deletion.resolve({ ...loaded, pins: [], uncertainStarts: [] });
    await removal;
    expect(panel.snapshot!.pins).toEqual([]);
    expect(texts(panel)).toContain('Favorit „Windows build“ entfernt.');
  });

  it('refreshes the snapshot after a refused release, so a retry sees the newer claim', async () => {
    const newer = { ...claim, claimedAt: '2026-11-01T09:00:00Z' };
    const { panel, bridge, push } = await setup({
      releaseUncertainStart: async () => {
        throw new Error('Neuere Startsperre.');
      },
    });
    push({ ...panel.snapshot!, uncertainStarts: [claim] });
    const base = panel.snapshot!;
    bridge.refreshSnapshot = async () => ({
      ...base,
      uncertainStarts: [newer],
    });
    await expect(panel.starts.release(claim)).rejects.toThrow(
      'Neuere Startsperre.',
    );
    await flush();
    expect(panel.starts.claimFor(request)).toEqual(newer);
    expect(panel.starts.isReleasing(request)).toBe(false);
  });
});

describe('Starts local guard', () => {
  it('reads the snapshot after a rejected or failed start too', async () => {
    let reads = 0;
    let fail = false;
    const { panel, bridge } = await setup({
      dispatchWorkflow: async () => {
        if (fail) throw new Error('Verbindung unterbrochen.');
        return { state: 'rejected', message: 'Nein.' };
      },
    });
    const base = panel.snapshot!;
    // The service kept the claim it could not remove.
    bridge.snapshot = async () => (
      reads++,
      { ...base, uncertainStarts: [claim] }
    );
    await panel.starts.dispatch(request, { label: 'A' });
    expect(reads).toBe(1);
    expect(panel.starts.isQuarantined(request)).toBe(true);
    fail = true;
    await panel.starts.dispatch(other, { label: 'B' });
    expect(reads).toBe(2);
  });

  it('never sends a start for a locked target, whatever the caller checked', async () => {
    let dispatched = 0;
    const { panel, push } = await setup({
      dispatchWorkflow: async () => {
        dispatched++;
        return { state: 'accepted', runId: 9001, message: 'Angenommen.' };
      },
    });
    push({ ...panel.snapshot!, uncertainStarts: [claim] });
    expect(await panel.starts.dispatch(request, { owner: () => true })).toEqual(
      { error: START_REASONS.uncertain },
    );
    await panel.starts.dispatch(request, { label: 'Vorlage' });
    expect(texts(panel)).toEqual([`Vorlage: ${START_REASONS.uncertain}`]);
    expect(dispatched).toBe(0);
  });
});
