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

/**
 * Favorite changes from the views: heart toggles, removal with undo and
 * quick starts. They report in the banner, never in a dialog.
 */
export class Favorites {
  #panel: Panel;
  #bridge: Bridge;
  #mutate: PinMutation;

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
      () => panel.showNotice(`„${pin.label}“ als Favorit gespeichert.`),
    );
  };

  /** Removes at once and offers „Rückgängig“ for a few seconds. */
  remove = (pinId: string) => {
    const pin = this.#panel.snapshot?.pins.find((item) => item.id === pinId);
    return this.#change(
      () => this.#bridge.deletePin(pinId),
      () =>
        pin
          ? this.#offerUndo(pin)
          : this.#panel.showNotice('Favorit entfernt.'),
    );
  };

  /** Quick-starts a favorite; false when it needs the start dialog instead. */
  launch = (pin: Pin) => {
    if (!pin.quickStart) return false;
    void this.#panel.starts.dispatch(pinRequest(pin), { label: pin.label });
    return true;
  };

  #offerUndo(pin: Pin) {
    const panel = this.#panel;
    const key = `pin:${pin.id}`;
    panel.notices.show({
      key,
      text: `Favorit „${pin.label}“ entfernt.`,
      tone: 'subtle',
      timeout: UNDO_TIMEOUT,
      action: {
        label: 'Rückgängig',
        run: () => {
          if (panel.pinsBusy) return;
          panel.notices.clear(key);
          // The identical favorite: same id, label, inputs and quick start.
          void this.#change(
            () => this.#bridge.savePin(pin),
            () => panel.showNotice(`Favorit „${pin.label}“ wiederhergestellt.`),
          );
        },
      },
    });
  }

  #change = (run: () => Promise<Snapshot>, report: () => void) =>
    this.#mutate(async (ticket) => {
      const panel = this.#panel;
      try {
        const value = await run();
        if (!panel.viewEpoch.current(ticket)) return;
        panel.accept(value);
        report();
      } catch (cause) {
        if (panel.viewEpoch.current(ticket)) panel.error = errorMessage(cause);
      }
    });
}
