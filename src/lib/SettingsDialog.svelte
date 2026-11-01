<script module lang="ts">
  export const SETTINGS_TABS = [
    { id: 'accounts', label: 'Konten' },
    { id: 'app', label: 'App' },
    { id: 'updates', label: 'Updates' },
  ] as const;
  export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import AccountsTab from './AccountsTab.svelte';
  import Modal from './Modal.svelte';
  import StartupSettings from './StartupSettings.svelte';
  import ThemeSetting from './ThemeSetting.svelte';
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
    busy,
    returnFocus,
    onClose,
    onConnect,
    onChangeAccount,
    onScenario,
    onReset,
    onDisconnect,
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
    /** A settings mutation is running. */
    busy: boolean;
    returnFocus?: (() => HTMLElement | null | undefined) | undefined;
    onClose: () => void;
    /** Replaces this dialog with the connection dialog. */
    onConnect: () => void;
    onChangeAccount: (id: string) => void;
    // Mutations reject with a user-facing error; the dialog shows it.
    onScenario: (value: DemoScenario) => Promise<unknown>;
    onReset: () => Promise<unknown>;
    onDisconnect: (id: string) => Promise<unknown>;
  } = $props();

  // Every setting applies at once; repositories are chosen in the panel.
  let tab = $state<SettingsTab>(untrack(() => initialTab));
  let error = $state('');
  let alive = true;
  onDestroy(() => (alive = false));
  /** Tab states: a dot whose text is part of the tab's name, like the activity count. */
  const badges = $derived<Partial<Record<SettingsTab, string>>>({
    ...(updater.info && { updates: 'Update verfügbar' }),
  });

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
  const disconnect = (id: string) => attempt(() => onDisconnect(id));

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
    const target = SETTINGS_TABS[next];
    if (!target) return;
    tab = target.id;
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
  {onClose}
>
  <div
    class="settings-tabs"
    role="tablist"
    tabindex="-1"
    aria-label="Einstellungsbereiche"
    onkeydown={tabKey}
  >
    {#each SETTINGS_TABS as item (item.id)}
      <button
        id={`settings-tab-${item.id}`}
        role="tab"
        aria-selected={tab === item.id}
        aria-controls="settings-panel"
        tabindex={tab === item.id ? 0 : -1}
        onclick={() => (tab = item.id)}
        >{item.label}{#if badges[item.id]}<span
            class="tab-update-dot"
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
        {onConnect}
        onScenario={(value) => attempt(() => onScenario(value))}
        onReset={reset}
        onDisconnect={disconnect}
      />
    {:else if tab === 'app'}
      <ThemeSetting />
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
  <div class="modal-actions">
    <button class="secondary-button" onclick={() => onClose()}>Schließen</button
    >
  </div>
</Modal>
