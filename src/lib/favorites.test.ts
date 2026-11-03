import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBridge, type Bridge } from './demo';
import { RESTART_COOLDOWN, samePin } from './favorites.svelte';
import { Modals } from './modals.svelte';
import { Panel } from './panel.svelte';
import { START_REASONS } from './startReason';
import type { DispatchRequest, Pin, Snapshot } from './types';

const flush = () => new Promise((done) => setTimeout(done, 0));

/** A browser-demo panel whose pin saves the test counts. */
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
  const saved: Pin[] = [];
  const save = bridge.savePin;
  bridge.savePin = async (pin) => (saved.push(pin), save(pin));
  return { panel, bridge, saved, push: (value: Snapshot) => push(value) };
}
const undoOffer = (panel: Panel) =>
  panel.notices.items.find((item) => item.action?.label === 'Rückgängig');
const texts = (panel: Panel) => panel.notices.items.map((item) => item.text);

describe('Favorite undo', () => {
  it('skips „Rückgängig“ when the same favorite was saved again meanwhile', async () => {
    const { panel, saved, push } = await setup();
    const pin = panel.snapshot!.pins[0]!;
    await panel.favorites.remove(pin.id);
    const undo = undoOffer(panel)!;
    // Re-added elsewhere under a new id, e.g. from another panel window.
    push({ ...panel.snapshot!, pins: [{ ...pin, id: 'again', label: 'Neu' }] });
    undo.action!.run();
    await flush();
    expect(saved).toEqual([]);
    expect(panel.snapshot!.pins).toHaveLength(1);
    expect(texts(panel)).toEqual(['Favorit ist bereits wieder gespeichert.']);
  });

  it('restores a removed favorite next to an alike one that was already there', async () => {
    const { panel, saved } = await setup();
    const pin = panel.snapshot!.pins[0]!;
    const twin = {
      ...pin,
      id: 'twin',
      label: 'Zwilling',
      quickStart: true,
    };
    await panel.saveTemplate(twin);
    await panel.favorites.remove(pin.id);
    // Updating the twin does not re-add the removed favorite either.
    await panel.saveTemplate({ ...twin, label: 'Umbenannt' });
    undoOffer(panel)!.action!.run();
    await flush();
    expect(saved.at(-1)).toEqual(pin);
    expect(panel.snapshot!.pins.map((item) => item.id)).toEqual([
      'twin',
      pin.id,
    ]);
  });

  it('drops the undo offer when the heart saves the favorite again', async () => {
    const { panel } = await setup();
    const workflow = panel.snapshot!.workflows.find((item) => item.id === 101)!;
    await panel.favorites.remove(panel.snapshot!.pins[0]!.id);
    expect(undoOffer(panel)).toBeDefined();
    await panel.favorites.toggle(workflow);
    expect(undoOffer(panel)).toBeUndefined();
    expect(panel.snapshot!.pins).toHaveLength(1);
  });

  it('drops the undo offer when the dialog saves the favorite again', async () => {
    const { panel } = await setup();
    const pin = panel.snapshot!.pins[0]!;
    await panel.favorites.remove(pin.id);
    await panel.saveTemplate({ ...pin, id: 'copy', label: 'Kopie' });
    expect(undoOffer(panel)).toBeUndefined();
  });

  it('keeps the undo offer when another favorite is saved', async () => {
    const { panel } = await setup();
    const pin = panel.snapshot!.pins[0]!;
    await panel.favorites.remove(pin.id);
    await panel.saveTemplate({ ...pin, id: 'other', ref: 'develop' });
    expect(undoOffer(panel)).toBeDefined();
  });

  it('drops the undo offer when the active account changes', async () => {
    const { panel } = await setup();
    await panel.favorites.remove(panel.snapshot!.pins[0]!.id);
    panel.changeAccount('demo-work');
    expect(undoOffer(panel)).toBeUndefined();
  });

  it('matches favorites by target and inputs, not by label or mode', () => {
    const pin: Pin = {
      id: 'a',
      label: 'A',
      accountId: 'x',
      repoId: 'r',
      workflowId: 1,
      ref: 'main',
      inputs: { version: '1', dry_run: true },
      quickStart: false,
    };
    expect(
      samePin(pin, { ...pin, id: 'b', label: 'B', quickStart: true }),
    ).toBe(true);
    expect(samePin(pin, { ...pin, inputs: { version: '1' } })).toBe(false);
    expect(
      samePin(pin, { ...pin, inputs: { version: '1', dry_run: false } }),
    ).toBe(false);
    expect(samePin(pin, { ...pin, ref: 'develop' })).toBe(false);
  });
});

describe('Favorite start', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** A panel that records every dispatch instead of starting anything. */
  async function starting() {
    const sent: DispatchRequest[] = [];
    const context = await setup({
      dispatchWorkflow: async (request) => {
        sent.push(request);
        return { state: 'accepted', runId: 9001, message: 'Angenommen.' };
      },
    });
    return { ...context, sent };
  }
  /** The demo favorite without its required `version` input. */
  const incomplete = (pin: Pin): Pin => {
    const inputs = { ...pin.inputs };
    delete inputs.version;
    return { ...pin, inputs };
  };

  it('starts a complete favorite at once, whatever its legacy quickStart says', async () => {
    const { panel, sent } = await starting();
    const pin = panel.snapshot!.pins[0]!;
    expect(pin.quickStart).toBe(false);
    expect(panel.favorites.launch(pin)).toBeUndefined();
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      accountId: pin.accountId,
      repoId: pin.repoId,
      workflowId: pin.workflowId,
      ref: pin.ref,
      inputs: pin.inputs,
    });
    expect(texts(panel)).toEqual(['Windows build: Angenommen.']);
  });

  it('hands an incomplete favorite to the start dialog without sending', async () => {
    const { panel, sent } = await starting();
    const pin = incomplete(panel.snapshot!.pins[0]!);
    expect(panel.favorites.launch(pin)).toBe('incomplete');
    // A ref the workflow no longer offers needs the dialog too.
    const gone = { ...panel.snapshot!.pins[0]!, ref: 'gone' };
    expect(panel.favorites.launch(gone)).toBe('incomplete');
    await flush();
    expect(sent).toEqual([]);
  });

  it('opens an incomplete favorite in the dialog with its section open', async () => {
    vi.stubGlobal('document', { activeElement: null });
    vi.stubGlobal('HTMLElement', class {});
    const { panel, sent } = await starting();
    const modals = new Modals(panel, () => {});
    const pin = incomplete(panel.snapshot!.pins[0]!);
    modals.launchPin(pin);
    expect(modals.kind).toBe('dispatch');
    expect(modals.dispatchSeed).toEqual({
      pin,
      workflow: undefined,
      favorite: 'edit',
    });
    modals.close();
    modals.launchPin(panel.snapshot!.pins[0]!);
    expect(modals.kind).toBeNull();
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('keeps an uncertain target locked for the direct start', async () => {
    const { panel, sent, push } = await starting();
    const pin = panel.snapshot!.pins[0]!;
    const { accountId, repoId, workflowId, ref } = pin;
    push({
      ...panel.snapshot!,
      uncertainStarts: [
        {
          accountId,
          repoId,
          workflowId,
          ref,
          claimedAt: '2026-11-01T08:00:00Z',
        },
      ],
    });
    expect(panel.starts.favoriteGate(pin)).toMatchObject({
      reason: START_REASONS.uncertain,
      canStart: false,
      canOpen: true,
    });
    expect(panel.favorites.launch(pin)).toBeUndefined();
    await flush();
    expect(sent).toEqual([]);
  });

  it('refuses a second direct start while the first one runs', async () => {
    let answer!: () => void;
    const sent: DispatchRequest[] = [];
    const { panel } = await setup({
      dispatchWorkflow: (request) => {
        sent.push(request);
        return new Promise((done) => {
          answer = () =>
            done({ state: 'accepted', runId: 9001, message: 'Angenommen.' });
        });
      },
    });
    const pin = panel.snapshot!.pins[0]!;
    panel.favorites.launch(pin);
    expect(panel.starts.favoriteGate(pin).reason).toBe(START_REASONS.running);
    panel.favorites.launch(pin);
    answer();
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('refuses the same favorite again shortly after its start settled', async () => {
    let now = 1_000_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { panel, sent } = await starting();
    const pin = panel.snapshot!.pins[0]!;
    panel.favorites.launch(pin);
    await flush();
    expect(sent).toHaveLength(1);
    // A held key or a late second click right after the first start settled.
    expect(panel.starts.favoriteGate(pin).canStart).toBe(true);
    panel.favorites.launch(pin);
    now += RESTART_COOLDOWN - 1;
    panel.favorites.launch(pin);
    await flush();
    expect(sent).toHaveLength(1);
    now += 1;
    panel.favorites.launch(pin);
    await flush();
    expect(sent).toHaveLength(2);
  });

  it('keeps another favorite of the same workflow and ref startable', async () => {
    let now = 1_000_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { panel, sent } = await starting();
    const pin = panel.snapshot!.pins[0]!;
    const sibling: Pin = {
      ...pin,
      id: 'pin-sibling',
      label: 'Andere Eingaben',
      inputs: { ...pin.inputs, version: '9.9.9' },
    };
    panel.favorites.launch(pin);
    await flush();
    panel.favorites.launch(sibling);
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.inputs).toMatchObject({ version: '9.9.9' });
    // The first one is still cooling down.
    now += 1;
    panel.favorites.launch(pin);
    await flush();
    expect(sent).toHaveLength(2);
  });
});
