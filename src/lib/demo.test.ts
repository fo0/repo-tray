import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDemoBridge,
  PREFERENCE_KEY,
  type PreferenceStorage,
} from './demo';
import type { DispatchRequest, Pin } from './types';

const request = (
  overrides: Partial<DispatchRequest> = {},
): DispatchRequest => ({
  accountId: 'demo-personal',
  repoId: 'demo-personal-kit',
  workflowId: 101,
  ref: 'main',
  inputs: { target: 'windows-x64', version: '0.1.0', dry_run: true },
  requestId: 'request-a',
  ...overrides,
});
const memory = (): PreferenceStorage => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
};
afterEach(() => vi.useRealTimers());

describe('local demo bridge safety', () => {
  it('keeps snapshot reads isolated from caller mutations', async () => {
    const bridge = createDemoBridge(undefined, 0);
    const first = await bridge.snapshot();
    first.repos[0].selected = false;
    first.runs.length = 0;
    const next = await bridge.snapshot();
    expect(next.repos[0].selected).toBe(true);
    expect(next.runs).toHaveLength(5);
  });
  it('rejects account mismatch, unselected repo, read-only permission and non-dispatch workflow', async () => {
    const bridge = createDemoBridge(undefined, 0);
    for (const payload of [
      request({ accountId: 'demo-work' }),
      request({
        accountId: 'demo-work',
        repoId: 'demo-extra',
        workflowId: 401,
        inputs: {},
      }),
      request({ repoId: 'demo-personal-site', workflowId: 301, inputs: {} }),
      request({ workflowId: 102, inputs: {} }),
    ]) {
      expect((await bridge.dispatchWorkflow(payload)).state).toBe('rejected');
    }
    expect((await bridge.snapshot()).runs).toHaveLength(5);
  });
  it.each(['offline', 'forbidden'] as const)(
    'refuses %s starts while retaining the last data',
    async (scenario) => {
      const bridge = createDemoBridge(undefined, 0);
      const data = await bridge.setDemoScenario(scenario);
      expect(data.connectivity).toBe(scenario);
      expect(data.stale).toBe(scenario === 'offline');
      expect((await bridge.dispatchWorkflow(request())).state).toBe('rejected');
      const after = await bridge.refreshSnapshot();
      expect(after.runs).toHaveLength(5);
      expect(after.message).toBeTruthy();
    },
  );
  it('prevents double clicks and makes same-ID retries idempotent', async () => {
    vi.useFakeTimers();
    const bridge = createDemoBridge(undefined, 250);
    const first = bridge.dispatchWorkflow(request());
    const duplicate = await bridge.dispatchWorkflow(
      request({ requestId: 'second-click' }),
    );
    expect(duplicate.state).toBe('rejected');
    expect(duplicate.message).toMatch(/bereits verarbeitet/);
    await vi.advanceTimersByTimeAsync(250);
    const accepted = await first;
    expect(accepted.state).toBe('accepted');
    expect(accepted.runId).toBe(9001);
    expect(await bridge.dispatchWorkflow(request())).toEqual(accepted);
    expect((await bridge.snapshot()).runs).toHaveLength(6);
  });
  it('refuses one request ID reused with changed inputs, including in-flight', async () => {
    vi.useFakeTimers();
    const bridge = createDemoBridge(undefined, 100);
    const original = bridge.dispatchWorkflow(request());
    const changed = request({
      inputs: { target: 'linux-x64', version: '1', dry_run: true },
    });
    expect((await bridge.dispatchWorkflow(changed)).state).toBe('rejected');
    await vi.advanceTimersByTimeAsync(100);
    await original;
    expect((await bridge.dispatchWorkflow(changed)).state).toBe('rejected');
    expect((await bridge.snapshot()).runs).toHaveLength(6);
  });
  it('revalidates selected repository after an asynchronous response', async () => {
    vi.useFakeTimers();
    const bridge = createDemoBridge(undefined, 200);
    const pending = bridge.dispatchWorkflow(request());
    await bridge.selectRepos(['demo-team-tools']);
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending).state).toBe('rejected');
    expect((await bridge.snapshot()).runs).toHaveLength(5);
  });
  it('latches uncertain outcomes across refresh/scenario changes and changed inputs', async () => {
    const bridge = createDemoBridge(undefined, 0);
    await bridge.setDemoScenario('uncertain');
    expect((await bridge.dispatchWorkflow(request())).state).toBe('uncertain');
    await bridge.refreshSnapshot();
    await bridge.setDemoScenario('normal');
    expect(
      (
        await bridge.dispatchWorkflow(
          request({
            requestId: 'new-id',
            inputs: { target: 'linux-x64', version: '2', dry_run: false },
          }),
        )
      ).state,
    ).toBe('uncertain');
    expect((await bridge.snapshot()).runs).toHaveLength(5);
    await bridge.resetDemo();
    expect(
      (await bridge.dispatchWorkflow(request({ requestId: 'after-reset' })))
        .state,
    ).toBe('accepted');
  });
  it('lists an uncertain start and releases only the exact reviewed claim', async () => {
    const bridge = createDemoBridge(undefined, 0);
    expect((await bridge.snapshot()).uncertainStarts).toEqual([]);
    await bridge.setDemoScenario('uncertain');
    expect((await bridge.dispatchWorkflow(request())).state).toBe('uncertain');
    await bridge.setDemoScenario('normal');
    const [start, ...rest] = (await bridge.refreshSnapshot()).uncertainStarts!;
    expect(rest).toEqual([]);
    expect(start).toMatchObject({
      accountId: 'demo-personal',
      repoId: 'demo-personal-kit',
      workflowId: 101,
      ref: 'main',
    });
    expect(Date.parse(start.claimedAt!)).not.toBeNaN();
    await expect(
      bridge.releaseUncertainStart({ ...start, claimedAt: null }),
    ).rejects.toThrow(/neuere Startsperre/);
    expect((await bridge.snapshot()).uncertainStarts).toHaveLength(1);
    expect((await bridge.releaseUncertainStart(start)).uncertainStarts).toEqual(
      [],
    );
    // The uncertain request ID keeps its outcome; only a new ID starts again.
    expect((await bridge.dispatchWorkflow(request())).state).toBe('uncertain');
    expect(
      (await bridge.dispatchWorkflow(request({ requestId: 'after-release' })))
        .state,
    ).toBe('accepted');
    expect((await bridge.releaseUncertainStart(start)).uncertainStarts).toEqual(
      [],
    );
  });
  it('simulates queue, running, completed independently of acceptance', async () => {
    vi.useFakeTimers();
    const bridge = createDemoBridge(undefined, 100);
    const pending = bridge.dispatchWorkflow(request());
    await vi.advanceTimersByTimeAsync(100);
    const outcome = await pending;
    expect(outcome.message).toMatch(/keine Build-Erfolgsmeldung/);
    expect((await bridge.snapshot()).runs[0].status).toBe('queued');
    await vi.advanceTimersByTimeAsync(1000);
    expect((await bridge.snapshot()).runs[0].status).toBe('in_progress');
    await vi.advanceTimersByTimeAsync(1000);
    expect((await bridge.snapshot()).runs[0].conclusion).toBe('success');
  });
  it('a reset invalidates in-flight dispatch without re-creating the run', async () => {
    vi.useFakeTimers();
    const bridge = createDemoBridge(undefined, 100);
    const pending = bridge.dispatchWorkflow(request());
    await bridge.resetDemo();
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).state).toBe('rejected');
    expect((await bridge.snapshot()).runs).toHaveLength(5);
  });
  it('an old dispatch cannot release a new target lock after reset', async () => {
    vi.useFakeTimers();
    const bridge = createDemoBridge(undefined, 200);
    const old = bridge.dispatchWorkflow(request());
    await vi.advanceTimersByTimeAsync(100);
    await bridge.resetDemo();
    const current = bridge.dispatchWorkflow(request({ requestId: 'current' }));
    await vi.advanceTimersByTimeAsync(100);
    expect((await old).state).toBe('rejected');
    expect(
      (
        await bridge.dispatchWorkflow(
          request({ requestId: 'duplicate-current' }),
        )
      ).state,
    ).toBe('rejected');
    await vi.advanceTimersByTimeAsync(100);
    expect((await current).state).toBe('accepted');
    expect((await bridge.snapshot()).runs).toHaveLength(6);
  });
});

describe('non-secret preference persistence', () => {
  it('persists pins with all target fields and explicit quickStart opt-in only', async () => {
    const storage = memory();
    const bridge = createDemoBridge(storage, 0);
    const pin: Pin = {
      ...(await bridge.snapshot()).pins[0],
      id: 'custom',
      label: 'My pin',
      quickStart: true,
    };
    await bridge.savePin(pin);
    await bridge.selectRepos(['demo-team-tools']);
    const saved = JSON.parse(storage.getItem(PREFERENCE_KEY)!);
    expect(Object.keys(saved).sort()).toEqual(['pins', 'repoIds']);
    expect(saved.pins.find((item: Pin) => item.id === pin.id)).toEqual(pin);
    expect(
      (await createDemoBridge(storage, 0).snapshot()).pins.find(
        (item) => item.id === pin.id,
      ),
    ).toEqual(pin);
    expect(
      (await createDemoBridge(storage, 0).snapshot()).repos
        .filter((item) => item.selected)
        .map((item) => item.id),
    ).toEqual(['demo-team-tools']);
    await bridge.deletePin(pin.id);
    expect(
      (await createDemoBridge(storage, 0).snapshot()).pins.some(
        (item) => item.id === pin.id,
      ),
    ).toBe(false);
  });
  it('handles corrupt storage and ignores forged credential fields', async () => {
    const storage = memory();
    storage.setItem(PREFERENCE_KEY, '{broken');
    const bridge = createDemoBridge(storage, 0);
    expect((await bridge.snapshot()).pins).toHaveLength(1);
    const pin = {
      ...(await bridge.snapshot()).pins[0],
      token: 'never-persist-this',
    };
    await bridge.savePin(pin);
    expect(storage.getItem(PREFERENCE_KEY)).not.toContain('never-persist-this');
    const invalid = { ...pin, repoId: 'foreign-repo' };
    await expect(bridge.savePin(invalid)).rejects.toThrow();
  });
  it('does not persist simulated runs, scenarios, or request payloads', async () => {
    const storage = memory();
    const bridge = createDemoBridge(storage, 0);
    await bridge.savePin((await bridge.snapshot()).pins[0]);
    await bridge.dispatchWorkflow(request());
    await bridge.setDemoScenario('offline');
    const saved = storage.getItem(PREFERENCE_KEY)!;
    expect(saved).not.toContain('request-a');
    expect(saved).not.toContain('offline');
    expect(saved).not.toContain('9001');
    const reloaded = await createDemoBridge(storage, 0).snapshot();
    expect(reloaded.connectivity).toBe('online');
    expect(reloaded.runs).toHaveLength(5);
  });
});
