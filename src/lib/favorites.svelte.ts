import { tick } from 'svelte';
import type { Bridge } from './demo';
import { errorMessage } from './format';
import { validateDispatch } from './model';
import type { Panel } from './panel.svelte';
import { favoriteDraft, findFavorite, pinRequest } from './pins';
import type { Pin, Snapshot, Workflow } from './types';

/** How long „Rückgängig“ stays offered after a favorite was removed. */
export const UNDO_TIMEOUT = 8000;
/** Runs a pin change under the panel's pin busy flag and view epoch. */
export type PinMutation = (
  run: (ticket: number) => Promise<void>,
) => Promise<void | null>;

const UNDO_PREFIX = 'pin:';

/** The same favorite in effect: same target and the same inputs. */
export function samePin(a: Pin, b: Pin) {
  const keys = Object.keys(a.inputs);
  return (
    a.accountId === b.accountId &&
    a.repoId === b.repoId &&
    a.workflowId === b.workflowId &&
    a.ref === b.ref &&
    keys.length === Object.keys(b.inputs).length &&
    keys.every((key) => key in b.inputs && a.inputs[key] === b.inputs[key])
  );
}

// Focus moves only where a removed or restored card would otherwise drop it
// to <body>; the unit tests run without a DOM.
const hasDom = () => typeof document !== 'undefined';
const focusLost = () => {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
};
const pinCard = (id: string) =>
  document.querySelector<HTMLElement>(`[data-pin-id="${CSS.escape(id)}"]`);
const enabled = (card: HTMLElement | null, selector = 'button') =>
  [...(card?.querySelectorAll<HTMLButtonElement>(selector) ?? [])].find(
    (button) => !button.disabled,
  );
/** The active view tab: where focus lands when no card is left. */
const viewTab = () =>
  document.querySelector<HTMLElement>('[aria-current="page"]');
/** The nearest other card in one direction, by its pin id. */
function sibling(card: HTMLElement, forward: boolean) {
  let next = forward ? card.nextElementSibling : card.previousElementSibling;
  while (next && !next.hasAttribute('data-pin-id'))
    next = forward ? next.nextElementSibling : next.previousElementSibling;
  return next?.getAttribute('data-pin-id') ?? null;
}

/**
 * Favorite changes from the views: heart toggles, removal with undo and
 * quick starts. They report in the banner, never in a dialog.
 */
export class Favorites {
  #panel: Panel;
  #bridge: Bridge;
  #mutate: PinMutation;
  /**
   * Removed favorites that still offer „Rückgängig“, by notice key, with the
   * ids of the favorites kept at removal: only one added later re-adds it.
   */
  #removed = new Map<string, { pin: Pin; kept: Set<string> }>();

  constructor(panel: Panel, bridge: Bridge, mutate: PinMutation) {
    this.#panel = panel;
    this.#bridge = bridge;
    this.#mutate = mutate;
  }

  /** The heart favorite of a workflow, matched by target and default inputs. */
  find = (workflow: Workflow) => findFavorite(this.#panel.snapshot, workflow);

  /** Resolves to 'incomplete' when the favorite needs input in the dialog. */
  toggle = async (workflow: Workflow): Promise<'incomplete' | void> => {
    const panel = this.#panel;
    if (!panel.snapshot || panel.pinsBusy) return;
    const existing = this.find(workflow);
    // Only the favorite's own target is locked while it starts.
    if (existing && panel.starts.isRunning(existing)) return;
    if (existing) return void (await this.remove(existing.id));
    const pin = favoriteDraft(panel.snapshot, workflow);
    if (!pin || panel.starts.isRunning(pin)) return;
    if (validateDispatch(panel.snapshot, { ...pin, requestId: 'favorite' }))
      return 'incomplete';
    await this.#change(
      () => this.#bridge.savePin(pin),
      () => {
        this.saved(pin);
        panel.showNotice(`„${pin.label}“ als Favorit gespeichert.`);
      },
    );
  };

  /**
   * Removes at once and offers „Rückgängig“ for a few seconds. Focus on the
   * removed card moves to the next card, or to the view tab.
   */
  remove = async (pinId: string) => {
    const pin = this.#panel.snapshot?.pins.find((item) => item.id === pinId);
    const card = hasDom() ? pinCard(pinId) : null;
    const owned = !!card && card.contains(document.activeElement);
    const neighbours = owned ? [sibling(card, true), sibling(card, false)] : [];
    const done = await this.#change(
      () => this.#bridge.deletePin(pinId),
      () =>
        pin
          ? this.#offerUndo(pin)
          : this.#panel.showNotice('Favorit entfernt.'),
    );
    if (!owned || done === null) return;
    await tick();
    if (!focusLost()) return;
    if (this.#panel.snapshot?.pins.some((item) => item.id === pinId))
      return enabled(pinCard(pinId), '[data-pin-remove]')?.focus();
    for (const id of neighbours) {
      const next = id ? pinCard(id) : null;
      const target = enabled(next, '[data-pin-remove]') ?? enabled(next);
      if (target) return target.focus();
    }
    viewTab()?.focus();
  };

  /** Quick-starts a favorite; false when it needs the start dialog instead. */
  launch = (pin: Pin) => {
    if (!pin.quickStart) return false;
    void this.#panel.starts.dispatch(pinRequest(pin), { label: pin.label });
    return true;
  };

  /** A favorite was saved: an undo offer for the same favorite is moot. */
  saved(pin: Pin) {
    for (const [key, removed] of this.#removed)
      if (this.#readds(removed, pin)) this.#forget(key);
  }

  /** Whether `pin` brings a removed favorite back: same id, or new and alike. */
  #readds(removed: { pin: Pin; kept: Set<string> }, pin: Pin) {
    return (
      pin.id === removed.pin.id ||
      (!removed.kept.has(pin.id) && samePin(pin, removed.pin))
    );
  }

  /** Drops every undo offer, e.g. when the active account changes. */
  clearUndo() {
    for (const key of this.#removed.keys()) this.#forget(key);
  }

  #forget(key: string) {
    this.#removed.delete(key);
    this.#panel.notices.clear(key);
  }

  #offerUndo(pin: Pin) {
    const panel = this.#panel;
    const key = `${UNDO_PREFIX}${pin.id}`;
    // Offers that closed on their own need no clearing any more.
    for (const known of this.#removed.keys())
      if (!panel.notices.get(known)) this.#removed.delete(known);
    const kept = new Set(panel.snapshot?.pins.map((item) => item.id));
    this.#removed.set(key, { pin, kept });
    panel.notices.show({
      key,
      text: `Favorit „${pin.label}“ entfernt.`,
      tone: 'subtle',
      timeout: UNDO_TIMEOUT,
      action: { label: 'Rückgängig', run: () => void this.#undo(key) },
    });
  }

  async #undo(key: string) {
    const panel = this.#panel;
    const removed = this.#removed.get(key);
    if (panel.pinsBusy || !removed) return;
    const { pin } = removed;
    this.#forget(key);
    // Saved again meanwhile: a second save would duplicate it.
    const existing = panel.snapshot?.pins.find((item) =>
      this.#readds(removed, item),
    );
    if (existing) {
      panel.showNotice('Favorit ist bereits wieder gespeichert.');
      return this.#focusCard(existing.id);
    }
    // The identical favorite: same id, label, inputs and quick start.
    const done = await this.#change(
      () => this.#bridge.savePin(pin),
      () => panel.showNotice(`Favorit „${pin.label}“ wiederhergestellt.`),
    );
    if (done !== null) await this.#focusCard(pin.id);
  }

  /** Focus left with the undo button goes to the card, or the view tab. */
  async #focusCard(pinId: string) {
    if (!hasDom()) return;
    await tick();
    if (focusLost()) (enabled(pinCard(pinId)) ?? viewTab())?.focus();
  }

  /** A mutation always reports and accepts its own answer. */
  #change = (run: () => Promise<Snapshot>, report: () => void) =>
    this.#mutate(async () => {
      const panel = this.#panel;
      try {
        panel.accept(await run());
        report();
      } catch (cause) {
        panel.error = errorMessage(cause);
      }
    });
}
