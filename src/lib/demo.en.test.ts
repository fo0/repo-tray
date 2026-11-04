import { afterEach, describe, expect, it } from 'vitest';
import { createDemoBridge } from './demo';
import { setLocale } from './i18n/index.svelte';

afterEach(() => setLocale('de'));

describe('demo bridge in English', () => {
  it('reports banners, outcomes and errors in the language in effect', async () => {
    setLocale('en');
    const bridge = createDemoBridge(undefined, 0);
    const outcome = await bridge.dispatchWorkflow({
      accountId: 'demo-personal',
      repoId: 'demo-personal-kit',
      workflowId: 101,
      ref: 'main',
      inputs: { target: 'windows-x64', version: '0.1.0', dry_run: true },
      requestId: 'request-en',
    });
    expect(outcome.message).toMatch(/does not mean the build succeeded/);
    await expect(bridge.cancelRun('demo-personal-kit', -1)).rejects.toThrow(
      'Run not found.',
    );
    await expect(bridge.openRepository('missing')).rejects.toThrow(
      'Repository not found.',
    );
    expect((await bridge.setDemoScenario('offline')).message).toBe(
      'Offline: the last demo state stays visible. Nothing was started.',
    );
    setLocale('de');
    expect((await bridge.snapshot()).message).toMatch(/^Offline: Letzter/);
  });
});
