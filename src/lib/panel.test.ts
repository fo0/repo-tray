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
/** Banner notices without their generated id and key. */
const notices = (panel: Panel) =>
  panel.notices.items.map(({ text, tone, runId }) => ({ text, tone, runId }));
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
    expect(notices(panel)).toEqual([
      { text: 'Desktop build: Angenommen.', tone: 'subtle', runId: 9001 },
    ]);
  });

  it('records the result before it frees the target, so a watching dialog stays locked', async () => {
    const answer = deferred<DispatchOutcome>();
    const reload = deferred<Snapshot>();
    const { panel, bridge } = await setup({
      dispatchWorkflow: () => answer.promise,
    });
    const result = panel.starts.dispatch(request, { owner: () => false });
    const seq = panel.starts.runningSeq(request);
    expect(seq).toBeTypeOf('number');
    // The post-accept snapshot is still loading when the target is freed.
    bridge.snapshot = () => reload.promise;
    answer.resolve({ state: 'accepted', runId: 9001, message: 'Angenommen.' });
    await flush();
    expect(panel.starts.isRunning(request)).toBe(false);
    expect(panel.starts.settledFor(request)).toEqual({
      seq,
      result: {
        outcome: { state: 'accepted', runId: 9001, message: 'Angenommen.' },
      },
    });
    reload.resolve(panel.snapshot!);
    expect(await result).toBe(null);
  });

  it('hands the result to a dialog that still wants it', async () => {
    const { panel } = await setup({
      dispatchWorkflow: async () => ({ state: 'rejected', message: 'Nein.' }),
    });
    expect(await panel.starts.dispatch(request, { owner: () => true })).toEqual(
      { outcome: { state: 'rejected', message: 'Nein.' } },
    );
    expect(panel.notices.items).toEqual([]);
  });

  it('quarantines an uncertain target and never clears it on its own', async () => {
    const { panel } = await setup({
      dispatchWorkflow: async () => ({ state: 'uncertain', message: 'Offen.' }),
    });
    await panel.starts.dispatch(request, { label: 'Vorlage' });
    expect(panel.starts.isQuarantined(request)).toBe(true);
    expect(notices(panel)).toEqual([
      { text: 'Vorlage: Offen.', tone: 'warning', runId: undefined },
    ]);
  });

  it('locks persisted claims and releases exactly the reported claim without starting', async () => {
    const claim = {
      accountId: request.accountId,
      repoId: request.repoId,
      workflowId: request.workflowId,
      ref: request.ref,
      claimedAt: '2026-11-01T08:00:00Z',
    };
    const released: unknown[] = [];
    let dispatched = 0;
    const { panel, push } = await setup({
      dispatchWorkflow: async () => {
        dispatched++;
        return { state: 'uncertain', message: 'Offen.' };
      },
      releaseUncertainStart: async (start) => {
        released.push(start);
        return { ...panel.snapshot!, uncertainStarts: [] };
      },
    });
    // A restart: the claim arrives only through the snapshot.
    push({ ...panel.snapshot!, uncertainStarts: [claim] });
    expect(panel.starts.isQuarantined(request)).toBe(true);
    expect(panel.starts.claimFor(request)).toBe(claim);
    await panel.starts.release(panel.starts.claimFor(request)!);
    expect(released).toHaveLength(1);
    expect(released[0]).toBe(claim);
    expect(panel.starts.isQuarantined(request)).toBe(false);
    expect(dispatched).toBe(0);
  });

  it('keeps one banner per target: a later start neither clears nor overwrites another', async () => {
    const answers = new Map<
      string,
      ReturnType<typeof deferred<DispatchOutcome>>
    >();
    const { panel } = await setup({
      dispatchWorkflow: (payload) => {
        const answer = deferred<DispatchOutcome>();
        answers.set(payload.ref, answer);
        return answer.promise;
      },
    });
    const a = panel.starts.dispatch(request, { label: 'A' });
    answers.get('main')!.resolve({ state: 'uncertain', message: 'Offen.' });
    await a;
    const b = panel.starts.dispatch(
      { ...request, ref: 'develop', requestId: 'request-b' },
      { label: 'B' },
    );
    // Starting B keeps A's warning.
    expect(notices(panel).map((item) => item.text)).toEqual(['A: Offen.']);
    answers
      .get('develop')!
      .resolve({ state: 'accepted', runId: 9002, message: 'Angenommen.' });
    await b;
    expect(notices(panel)).toEqual([
      { text: 'A: Offen.', tone: 'warning', runId: undefined },
      { text: 'B: Angenommen.', tone: 'subtle', runId: 9002 },
    ]);
  });

  it('fetches the post-accept snapshot once the last running start settled', async () => {
    const answers = new Map<
      string,
      ReturnType<typeof deferred<DispatchOutcome>>
    >();
    let reads = 0;
    const accepted = { updatedAt: 'after-accept' };
    const { panel, bridge } = await setup({
      dispatchWorkflow: (payload) => {
        const answer = deferred<DispatchOutcome>();
        answers.set(payload.ref, answer);
        return answer.promise;
      },
    });
    const base = await bridge.snapshot();
    bridge.snapshot = async () => {
      reads++;
      return { ...base, ...accepted };
    };
    const a = panel.starts.dispatch(request, { label: 'A' });
    const b = panel.starts.dispatch(
      { ...request, ref: 'develop', requestId: 'request-b' },
      { label: 'B' },
    );
    answers
      .get('main')!
      .resolve({ state: 'accepted', runId: 9001, message: 'Angenommen.' });
    await a;
    // B still runs: no snapshot yet, and none that B could discard.
    expect(reads).toBe(0);
    answers.get('develop')!.resolve({ state: 'rejected', message: 'Nein.' });
    await b;
    expect(reads).toBe(1);
    expect(panel.snapshot?.updatedAt).toBe('after-accept');
  });
});

describe('Panel view state', () => {
  it('owns the expanded run next to the open repositories and resets both per account', async () => {
    const { panel } = await setup();
    panel.toggleRun(8401);
    panel.toggleRepo('demo-personal-kit');
    expect(panel.expandedRun).toBe(8401);
    panel.toggleRun(8402);
    expect(panel.expandedRun).toBe(8402);
    panel.changeAccount('demo-work');
    expect(panel.expandedRun).toBe(null);
    expect(panel.expandedRepos.size).toBe(0);
    panel.toggleRun(8401);
    panel.toggleRun(8401);
    expect(panel.expandedRun).toBe(null);
  });
});

describe('Panel mode', () => {
  it('labels only the browser demo as demo before the first snapshot arrives', () => {
    const pending = new Promise<Snapshot>(() => {});
    const observe = async () => () => {};
    for (const native of [true, false]) {
      const bridge = {
        ...createDemoBridge(undefined, 0),
        snapshot: () => pending,
      };
      const panel = new Panel({ bridge, native, observe });
      panel.load();
      expect(panel.snapshot).toBe(null);
      expect(panel.demo).toBe(!native);
    }
  });
});

describe('Panel busy state', () => {
  it('owns a pin deletion until it settles and holds pushed snapshots meanwhile', async () => {
    const answer = deferred<Snapshot>();
    const { panel, push } = await setup({ deletePin: () => answer.promise });
    const loaded = panel.snapshot!;
    const deletion = panel.favorites.remove(loaded.pins[0]!.id);
    expect(panel.pinsBusy).toBe(true);
    push({ ...loaded, updatedAt: 'pushed-mid-operation' });
    expect(panel.snapshot).toBe(loaded);
    const after = { ...loaded, pins: [] };
    answer.resolve(after);
    await deletion;
    expect(panel.pinsBusy).toBe(false);
    expect(panel.snapshot).toBe(after);
    expect(panel.notices.items.map((item) => item.text)).toEqual([
      'Favorit „Windows build“ entfernt.',
    ]);
  });

  it('offers to undo a removal by saving the identical favorite again', async () => {
    const saved: unknown[] = [];
    const { panel, bridge } = await setup();
    const pin = { ...panel.snapshot!.pins[0]!, quickStart: true };
    await panel.saveTemplate(pin);
    const save = bridge.savePin;
    bridge.savePin = async (value) => {
      saved.push(value);
      return save(value);
    };
    await panel.favorites.remove(pin.id);
    expect(panel.snapshot!.pins).toEqual([]);
    const undo = panel.notices.items.find((item) => item.action);
    expect(undo).toMatchObject({
      text: 'Favorit „Windows build“ entfernt.',
      tone: 'subtle',
      timeout: 8000,
      action: { label: 'Rückgängig' },
    });
    undo!.action!.run();
    await flush();
    expect(saved).toEqual([pin]);
    expect(panel.snapshot!.pins).toEqual([pin]);
    expect(panel.notices.items.map((item) => item.text)).toEqual([
      'Favorit „Windows build“ wiederhergestellt.',
    ]);
  });

  it('keeps operations independent: a template save does not mark pins busy', async () => {
    const answer = deferred<Snapshot>();
    const { panel } = await setup({ savePin: () => answer.promise });
    const pin = panel.snapshot!.pins[0]!;
    const save = panel.saveTemplate(pin);
    expect(panel.templateBusy).toBe(true);
    expect(panel.pinsBusy).toBe(false);
    expect(await panel.saveTemplate(pin)).toBe(false);
    answer.resolve(panel.snapshot!);
    expect(await save).toBe(true);
    expect(panel.templateBusy).toBe(false);
  });
});
