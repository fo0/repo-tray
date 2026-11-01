import type { DispatchSeed } from './DispatchDialog.svelte';
import type { SettingsTab } from './SettingsDialog.svelte';
import type { Panel } from './panel.svelte';
import type { Pin, Workflow } from './types';

/**
 * Opens the Verlauf with the run expanded and focused; `opener` is the
 * element that opened the closed dialog, if any, for the way back.
 */
export type RevealRun = (
  runId: number | null,
  opener?: HTMLElement | null,
) => unknown;

export type ModalKind = 'settings' | 'dispatch' | 'connect';

/**
 * Which dialog is open and where focus returns afterwards. Dialogs own only
 * their form state; running operations live in the Panel and outlive them.
 */
export class Modals {
  kind = $state<ModalKind | null>(null);
  settingsTab = $state<SettingsTab>('accounts');
  /** Login of a just-connected account whose repositories come next. */
  settingsConnected = $state('');
  dispatchSeed = $state.raw<DispatchSeed>({});
  /** Element that opened the first of possibly chained dialogs. */
  opener: HTMLElement | null = null;
  #panel: Panel;
  #reveal: RevealRun;

  /** `reveal` switches to the full Verlauf with the run expanded (`PanelView.showRun`). */
  constructor(panel: Panel, reveal: RevealRun) {
    this.#panel = panel;
    this.#reveal = reveal;
  }

  returnFocus = () => this.opener;
  close = () => {
    this.kind = null;
  };
  /** Opens or replaces the dialog; a replacement keeps the first opener. */
  show = (kind: ModalKind) => {
    if (!this.kind)
      this.opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    this.kind = kind;
  };
  openSettings = (initial: SettingsTab = 'accounts', connected = '') => {
    this.settingsTab = initial;
    this.settingsConnected = connected;
    this.show('settings');
  };
  openDispatch = (pin?: Pin, workflow?: Workflow, favoriteIntent = false) => {
    this.dispatchSeed = { pin, workflow, favoriteIntent };
    this.show('dispatch');
  };
  /** Quick-starts a favorite, or opens it in the start dialog. */
  launchPin = (pin: Pin) => {
    if (!this.#panel.favorites.launch(pin)) this.openDispatch(pin);
  };
  /** Toggles a heart favorite; one that still needs input opens the dialog. */
  toggleFavorite = async (workflow: Workflow) => {
    if ((await this.#panel.favorites.toggle(workflow)) === 'incomplete')
      this.openDispatch(undefined, workflow, true);
  };
  /** Shows an accepted start in the full Verlauf and focuses its row. */
  showRun = async (id: number | null) => {
    // From a dialog, its opener is where the way back leads; from a notice,
    // the reveal takes the focused element itself.
    const opener = this.kind ? this.opener : undefined;
    this.close();
    await this.#reveal(id, opener);
  };
}
