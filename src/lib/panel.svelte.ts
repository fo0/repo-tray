import type { NoticeTone } from './StatusBanners.svelte';
import {
  readActiveAccount,
  rememberActiveAccount,
  restoreActiveAccount,
} from './accountSelection';
import type { Bridge, DemoControls } from './demo';
import { Favorites } from './favorites.svelte';
import { errorMessage } from './format';
import { call } from './ipc';
import { RequestEpoch } from './model';
import { Notices, PANEL_NOTICE } from './notices.svelte';
import { Starts } from './starts.svelte';
import type { DemoScenario, Pin, Snapshot } from './types';

type BusyFlag =
  'pinsBusy' | 'templateBusy' | 'accountBusy' | 'accessBusy' | 'resetBusy';
/** With accounts left the user picks one; without any, connecting comes first. */
const nextAccountStep = (value: Snapshot, pick: string) =>
  value.accounts.length ? pick : 'Verbinde ein GitHub-Konto, um fortzufahren.';
export interface PanelDeps {
  /** Demo controls exist only in the browser demo. */
  bridge: Bridge & Partial<DemoControls>;
  native: boolean;
  observe: (callback: (snapshot: Snapshot) => void) => Promise<() => void>;
}

/**
 * Panel data and every mutation. Dialogs keep only their form state, so
 * closing one never drops a running operation's result or busy state.
 */
export class Panel {
  // Snapshots are replaced wholesale, never mutated: no deep proxy needed.
  snapshot = $state.raw<Snapshot | null>(null);
  accountId = $state('');
  /** Why the active account has to be chosen (again). */
  accountNotice = $state('');
  scenario = $state<DemoScenario>('normal');
  error = $state('');
  refreshing = $state(false);
  // Every operation owns its busy flag; closing a dialog clears none of them.
  pinsBusy = $state(false);
  templateBusy = $state(false);
  accountBusy = $state(false);
  accessBusy = $state(false);
  resetBusy = $state(false);

  readonly native: boolean;
  readonly starts: Starts;
  readonly favorites: Favorites;
  readonly notices = new Notices();
  readonly viewEpoch = new RequestEpoch();
  #bridge: PanelDeps['bridge'];
  #observe: PanelDeps['observe'];
  #accountReady = false;

  blocked = $derived(this.snapshot?.connectivity !== 'online');
  settingsBusy = $derived(
    this.accountBusy || this.accessBusy || this.resetBusy,
  );
  /** A mutation could still change state; pushed snapshots wait meanwhile. */
  mutating = $derived(this.settingsBusy || this.pinsBusy || this.templateBusy);

  constructor({ bridge, native, observe }: PanelDeps) {
    this.#bridge = bridge;
    this.native = native;
    this.#observe = observe;
    this.starts = new Starts(this, bridge);
    this.favorites = new Favorites(this, bridge, (run) =>
      this.#mutation('pinsBusy', run),
    );
  }

  /** Native is never labelled demo, not even before its first snapshot. */
  get demo() {
    return this.snapshot ? this.snapshot.mode !== 'live' : !this.native;
  }
  /** Native mode without a deliberately chosen account shows no repository data. */
  get needsAccount() {
    return this.native && !this.accountId;
  }
  /** Selected repositories of the active account. */
  get repos() {
    return (
      this.snapshot?.repos.filter(
        (repo) =>
          repo.selected &&
          (this.native
            ? repo.accountId === this.accountId
            : !this.accountId || repo.accountId === this.accountId),
      ) ?? []
    );
  }
  /** Expanded repositories; shared by the overview and the Repositories page. */
  expandedRepos = $state.raw(new Set<string>());
  toggleRepo = (repoId: string) => {
    const next = new Set(this.expandedRepos);
    if (!next.delete(repoId)) next.add(repoId);
    this.expandedRepos = next;
  };
  /** The run whose details are open in the Verlauf, if any. */
  expandedRun = $state<number | null>(null);
  toggleRun = (runId: number) => {
    this.expandedRun = this.expandedRun === runId ? null : runId;
  };
  /** Whether this account's runs appear in the Verlauf right now. */
  showsAccount = (accountId: string) =>
    this.native
      ? accountId === this.accountId
      : !this.accountId || accountId === this.accountId;
  /** Native views stay empty until an account is chosen deliberately. */
  get viewSnapshot() {
    return this.snapshot && (!this.native || this.accountId)
      ? this.snapshot
      : null;
  }

  /** The one general notice; start results keep their own per target. */
  showNotice(text: string, tone: NoticeTone = 'subtle') {
    this.notices.show({ key: PANEL_NOTICE, text, tone });
  }

  accept(value: Snapshot) {
    this.starts.retainAccounts(value);
    this.snapshot = value;
    if (!this.native) return;
    if (!this.#accountReady) {
      const restored = restoreActiveAccount(
        value.accounts,
        readActiveAccount(),
      );
      this.accountId = restored.id;
      this.accountNotice = restored.missing
        ? `Das gespeicherte Konto ist nicht mehr verbunden. ${nextAccountStep(value, 'Wähle ein aktives Konto neu aus.')}`
        : '';
      if (restored.missing) rememberActiveAccount('');
      this.#accountReady = true;
    } else if (
      this.accountId &&
      !value.accounts.some((account) => account.id === this.accountId)
    ) {
      this.changeAccount('');
      this.accountNotice = `Das aktive Konto wurde entfernt. ${nextAccountStep(value, 'Wähle ein anderes aktives Konto aus.')}`;
    }
  }

  /** Loads the first snapshot and follows pushed ones; returns the cleanup. */
  load(onLoaded?: () => void) {
    const ticket = this.viewEpoch.next();
    this.#bridge
      .snapshot()
      .then((value) => {
        if (!this.viewEpoch.current(ticket)) return;
        this.accept(value);
        onLoaded?.();
      })
      .catch((cause) => {
        if (this.viewEpoch.current(ticket)) this.error = errorMessage(cause);
      });
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void this.#observe((value) => {
      if (!disposed && !this.mutating && !this.starts.any) this.accept(value);
    }).then((stop) => {
      if (disposed) stop();
      else unsubscribe = stop;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
      this.viewEpoch.invalidate();
      this.refreshing = false;
    };
  }

  changeAccount(value: string) {
    this.viewEpoch.invalidate();
    this.refreshing = false;
    // The expanded run and open repositories belong to the previous view.
    this.expandedRun = null;
    this.expandedRepos = new Set();
    this.accountId =
      this.native &&
      value &&
      !this.snapshot?.accounts.some((account) => account.id === value)
        ? ''
        : value;
    this.accountNotice = '';
    if (this.native && !rememberActiveAccount(this.accountId))
      this.accountNotice =
        'Die Kontoauswahl konnte nicht gespeichert werden und gilt nur für diese Sitzung.';
    this.error = '';
    this.notices.clear(PANEL_NOTICE);
    // „Rückgängig“ belongs to the previous account's view.
    this.favorites.clearUndo();
  }

  /** Resolves to null when the refresh failed or a newer view change won. */
  async refresh(): Promise<Snapshot | null> {
    if (this.refreshing) return null;
    const ticket = this.viewEpoch.next();
    this.refreshing = true;
    this.error = '';
    this.notices.clear(PANEL_NOTICE);
    try {
      const value = await this.#bridge.refreshSnapshot();
      if (!this.viewEpoch.current(ticket)) return null;
      this.accept(value);
      if (!value.stale)
        this.showNotice(
          this.demo
            ? 'Demo-Status aktualisiert.'
            : 'GitHub-Status aktualisiert.',
        );
      return value;
    } catch (cause) {
      if (this.viewEpoch.current(ticket)) this.error = errorMessage(cause);
      return null;
    } finally {
      if (this.viewEpoch.current(ticket)) this.refreshing = false;
    }
  }

  // Dialog mutations reject with a user-facing error for the dialog.
  /** Resolves to false when another template save is still running. */
  saveTemplate = async (pin: Pin) =>
    !!(await this.#mutation('templateBusy', async (ticket) => {
      const value = await this.#bridge.savePin(pin);
      if (this.viewEpoch.current(ticket)) this.accept(value);
      this.favorites.saved(pin);
      return true;
    }));

  disconnectAccount = (accountId: string) =>
    this.#mutation('accountBusy', async () => {
      this.accept(await call('disconnect_account', { accountId }));
    });

  refreshAccess = () =>
    this.#mutation('accessBusy', async (ticket) => {
      const value = await call('refresh_repositories');
      if (!this.viewEpoch.current(ticket)) return null;
      this.accept(value);
      return value;
    });

  manageInstallation = () => call('open_browser_installation');

  // The native settings offer no scenario or reset; both stay no-ops there.
  changeScenario = async (value: DemoScenario) => {
    if (!this.#bridge.setDemoScenario) return;
    const ticket = this.viewEpoch.next();
    this.refreshing = false;
    this.scenario = value;
    const data = await this.#bridge.setDemoScenario(value);
    if (this.viewEpoch.current(ticket)) this.snapshot = data;
  };

  resetDemo = () =>
    this.#mutation('resetBusy', async (ticket) => {
      if (!this.#bridge.resetDemo) return;
      const value = await this.#bridge.resetDemo();
      if (this.viewEpoch.current(ticket)) this.accept(value);
      this.accountId = '';
      this.scenario = 'normal';
      this.starts.clearQuarantine();
      this.showNotice('Demo zurückgesetzt.');
    });

  async #mutation<T>(
    flag: BusyFlag,
    run: (ticket: number) => Promise<T>,
  ): Promise<T | null> {
    if (this[flag]) return null;
    this[flag] = true;
    const ticket = this.viewEpoch.next();
    this.refreshing = false;
    try {
      return await run(ticket);
    } finally {
      this[flag] = false;
    }
  }
}
