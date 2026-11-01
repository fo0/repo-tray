import { describe, expect, it } from 'vitest';
import { createDemoBridge, type Bridge } from './demo';
import { Panel } from './panel.svelte';
import type { DispatchOutcome, DispatchRequest, Snapshot } from './types';

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

describe('Panel starts', () => {
  it('reports a start in the banner when its dialog no longer wants the result', async () => {
    const answer = deferred<DispatchOutcome>();
    const { panel } = await setup({ dispatchWorkflow: () => answer.promise });
    const result = panel.starts.dispatch(request, { owner: () => false });
    expect(panel.starts.isRunning(request)).toBe(true);
    // The same target cannot start twice while the first start runs.
    expect(await panel.starts.dispatch({ ...request, requestId: 'b' })).toBe(
      null,
    );
    answer.resolve({ state: 'accepted', runId: 9001, message: 'Angenommen.' });
    expect(await result).toBe(null);
    expect(panel.starts.isRunning(request)).toBe(false);
    expect(panel.notice).toEqual({
      text: 'Desktop build: Angenommen.',
      tone: 'subtle',
      runId: 9001,
    });
  });

  it('hands the result to a dialog that still wants it', async () => {
    const { panel } = await setup({
      dispatchWorkflow: async () => ({ state: 'rejected', message: 'Nein.' }),
    });
    expect(await panel.starts.dispatch(request, { owner: () => true })).toEqual(
      { outcome: { state: 'rejected', message: 'Nein.' } },
    );
    expect(panel.notice).toBe(null);
  });

  it('quarantines an uncertain target and never clears it on its own', async () => {
    const { panel } = await setup({
      dispatchWorkflow: async () => ({ state: 'uncertain', message: 'Offen.' }),
    });
    await panel.starts.dispatch(request, { label: 'Vorlage' });
    expect(panel.starts.isQuarantined(request)).toBe(true);
    expect(panel.notice).toEqual({
      text: 'Vorlage: Offen.',
      tone: 'warning',
      runId: undefined,
    });
  });
});

describe('Panel busy state', () => {
  it('owns a pin deletion until it settles and holds pushed snapshots meanwhile', async () => {
    const answer = deferred<Snapshot>();
    const { panel, push } = await setup({ deletePin: () => answer.promise });
    const loaded = panel.snapshot!;
    const deletion = panel.deletePin(loaded.pins[0].id);
    expect(panel.pinsBusy).toBe(true);
    push({ ...loaded, updatedAt: 'pushed-mid-operation' });
    expect(panel.snapshot).toBe(loaded);
    const after = { ...loaded, pins: [] };
    answer.resolve(after);
    await deletion;
    expect(panel.pinsBusy).toBe(false);
    expect(panel.snapshot).toBe(after);
    expect(panel.notice?.text).toBe('Vorlage entfernt.');
  });

  it('keeps operations independent: a template save does not mark pins busy', async () => {
    const answer = deferred<Snapshot>();
    const { panel } = await setup({ savePin: () => answer.promise });
    const pin = panel.snapshot!.pins[0];
    const save = panel.saveTemplate(pin);
    expect(panel.templateBusy).toBe(true);
    expect(panel.pinsBusy).toBe(false);
    expect(await panel.saveTemplate(pin)).toBe(false);
    answer.resolve(panel.snapshot!);
    expect(await save).toBe(true);
    expect(panel.templateBusy).toBe(false);
  });
});
