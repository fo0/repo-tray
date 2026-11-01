<script module lang="ts">
  export const SETTINGS_TABS = [
    { id: 'accounts', label: 'Konten' },
    { id: 'repositories', label: 'Repositories' },
    { id: 'app', label: 'App' },
    { id: 'updates', label: 'Updates' },
  ] as const;
  export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];
</script>

<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import AccountsTab from './AccountsTab.svelte';
  import Icon from './Icon.svelte';
  import InlineConfirm from './InlineConfirm.svelte';
  import Modal from './Modal.svelte';
  import ReposTab from './ReposTab.svelte';
  import StartupSettings from './StartupSettings.svelte';
  import UpdatePanel from './UpdatePanel.svelte';
  import { errorMessage } from './format';
  import type { DemoScenario, Snapshot } from './types';
  import type { Updater } from './updater.svelte';

  let {
    snapshot,
    native,
    demo,
    accountId,
    accountNotice,
    scenario,
    updater,
    appVersion,
    initialTab = 'accounts',
    connected = '',
    busy,
    saving,
    returnFocus,
    onClose,
    onConnect,
    onChangeAccount,
    onScenario,
    onReset,
    onDisconnect,
    onSaveSelection,
    onRefreshAccess,
    onManageInstallation,
  }: {
    snapshot: Snapshot | null;
    native: boolean;
    demo: boolean;
    accountId: string;
    accountNotice: string;
    scenario: DemoScenario;
    updater: Updater;
    appVersion: string;
    initialTab?: SettingsTab;
    /** Login of a just-connected account; the repository tab names the next step. */
    connected?: string;
    /** A settings mutation is running. */
    busy: boolean;
    /** The repository selection is being saved. */
    saving: boolean;
    returnFocus?: () => HTMLElement | null | undefined;
    onClose: () => void;
    /** Replaces this dialog with the connection dialog. */
    onConnect: () => void;
    onChangeAccount: (id: string) => void;
    // Mutations reject with a user-facing error; the dialog shows it.
    onScenario: (value: DemoScenario) => Promise<unknown>;
    onReset: () => Promise<unknown>;
    onDisconnect: (id: string) => Promise<unknown>;
    onSaveSelection: (repoIds: string[]) => Promise<unknown>;
    /** Resolves to null when a newer view change superseded the result. */
    onRefreshAccess: () => Promise<Snapshot | null>;
    onManageInstallation: () => Promise<unknown>;
  } = $props();

  const savedSelection = () =>
    snapshot?.repos.filter((repo) => repo.selected).map((repo) => repo.id) ??
    [];
  let tab = $state<SettingsTab>(untrack(() => initialTab));
  let query = $state('');
  let selected = $state<string[]>(untrack(savedSelection));
  let error = $state('');
  let alive = true;
  onDestroy(() => (alive = false));
  /** Ticked IDs that still exist; a vanished repository is no pending edit. */
  const known = (ids: string[]) =>
    ids.filter((id) => snapshot?.repos.some((repo) => repo.id === id));
  /** The repository selection differs from the saved one. */
  const dirty = $derived.by(() => {
    const saved = savedSelection();
    const current = known(selected);
    return (
      current.length !== saved.length ||
      current.some((id) => !saved.includes(id))
    );
  });
  /** Tab states: a dot whose text is part of the tab's name, like the activity count. */
  const badges = $derived<Partial<Record<SettingsTab, string>>>({
    ...(dirty && { repositories: 'Auswahl nicht gespeichert' }),
    ...(updater.info && { updates: 'Update verfügbar' }),
  });
  /** Leaving action that waits for „Verwerfen“; null while nobody is asked. */
  let discarding = $state.raw<(() => void) | null>(null);
  let saveButton = $state<HTMLButtonElement>();

  /** Account and app settings apply at once; only the selection can be lost. */
  function leave(action: () => void) {
    if (discarding) return;
    if (dirty && !saving) discarding = action;
    else action();
  }
  function discard() {
    const action = discarding;
    discarding = null;
    selected = savedSelection();
    action?.();
  }
  async function keepEditing() {
    discarding = null;
    tab = 'repositories';
    await tick();
    saveButton?.focus();
  }

  /** Runs a mutation and shows its error while this dialog is still open. */
  async function attempt(run: () => Promise<unknown>) {
    error = '';
    try {
      await run();
    } catch (cause) {
      if (alive) error = errorMessage(cause);
    }
  }
  const reset = () =>
    attempt(async () => {
      await onReset();
      if (alive) onClose();
    });
  const disconnect = (id: string) =>
    attempt(async () => {
      await onDisconnect(id);
      // Unsaved edits for the remaining accounts survive the disconnect.
      selected = known(selected);
    });
  const save = () =>
    attempt(async () => {
      await onSaveSelection(selected);
      if (alive) onClose();
    });
  const refreshAccess = () =>
    attempt(async () => {
      const value = await onRefreshAccess();
      if (!value) return;
      selected = selected.filter((id) =>
        value.repos.some((repo) => repo.id === id),
      );
      if (value.stale)
        error =
          value.message ??
          'Repository-Zugriff konnte nicht aktualisiert werden. Versuche es erneut.';
    });

  function tabKey(event: KeyboardEvent & { currentTarget: HTMLElement }) {
    const direction =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const count = SETTINGS_TABS.length;
    const index = SETTINGS_TABS.findIndex((item) => item.id === tab);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? count - 1
          : (index + direction + count) % count;
    tab = SETTINGS_TABS[next].id;
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role=tab]')
      [next]?.focus();
  }
</script>

<Modal
  title="Einstellungen"
  eyebrow={`REPOTRAY · ${demo ? 'DEMO' : 'GITHUB'}`}
  wide
  {returnFocus}
  onClose={() => leave(onClose)}
>
  <div
    class="settings-tabs"
    role="tablist"
    tabindex="-1"
    aria-label="Einstellungsbereiche"
    onkeydown={tabKey}
  >
    {#each SETTINGS_TABS as item}
      <button
        id={`settings-tab-${item.id}`}
        role="tab"
        aria-selected={tab === item.id}
        aria-controls="settings-panel"
        tabindex={tab === item.id ? 0 : -1}
        onclick={() => (tab = item.id)}
        >{item.label}{#if badges[item.id]}<span
            class="tab-update-dot"
            class:unsaved={item.id === 'repositories'}
            role="img"
            aria-label={badges[item.id]}
          ></span>{/if}</button
      >
    {/each}
  </div>
  <div
    class="modal-body"
    id="settings-panel"
    role="tabpanel"
    aria-labelledby={`settings-tab-${tab}`}
    tabindex="0"
  >
    {#if tab === 'accounts'}
      <AccountsTab
        {snapshot}
        {native}
        {demo}
        {accountId}
        {accountNotice}
        {scenario}
        {busy}
        {onChangeAccount}
        onConnect={() => leave(onConnect)}
        onScenario={(value) => attempt(() => onScenario(value))}
        onReset={reset}
        onDisconnect={disconnect}
      />
    {:else if tab === 'repositories'}
      <ReposTab
        {snapshot}
        {demo}
        {connected}
        {busy}
        {dirty}
        bind:query
        bind:selected
        onManageInstallation={() => attempt(onManageInstallation)}
        onRefreshAccess={refreshAccess}
      />
    {:else if tab === 'app'}
      <StartupSettings {native} />
    {:else}
      <UpdatePanel
        currentVersion={appVersion}
        {native}
        info={updater.info}
        phase={updater.phase}
        progress={updater.progress}
        error={updater.message}
        checkedAt={updater.checkedAt}
        onCheck={() => updater.check()}
        onDownload={updater.download}
        onInstall={updater.install}
      />
    {/if}
  </div>
  {#if error}<div class="dialog-alert danger" role="alert">
      {error}
    </div>{/if}
  {#if discarding}<div class="modal-actions settings-discard">
      <InlineConfirm
        id="settings-discard"
        title="Änderungen verwerfen?"
        text="Deine geänderte Repository-Auswahl ist noch nicht gespeichert."
        confirmLabel="Verwerfen"
        cancelLabel="Weiter bearbeiten"
        onConfirm={discard}
        onCancel={() => void keepEditing()}
      />
    </div>{:else}<div class="modal-actions">
      <button class="secondary-button" onclick={() => leave(onClose)}
        >Schließen</button
      >{#if tab === 'repositories'}<button
          class="primary-button"
          bind:this={saveButton}
          onclick={save}
          disabled={busy}
          >{saving ? 'Speichert …' : 'Auswahl speichern'}<Icon
            name="check"
            size={15}
          /></button
        >{/if}
    </div>{/if}
</Modal>
