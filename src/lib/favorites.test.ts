import { describe, expect, it } from 'vitest';
import { createDemoBridge, type Bridge } from './demo';
import { samePin } from './favorites.svelte';
import { Panel } from './panel.svelte';
import type { Pin, Snapshot } from './types';

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
      label: 'Schnellstart',
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
