<script lang="ts">
  import AccountMenu from './AccountMenu.svelte';
  import Icon from './Icon.svelte';
  import type { Account, Snapshot } from './types';

  let {
    native,
    demo,
    accounts,
    accountId,
    accountName,
    connectivity,
    refreshing,
    ready,
    canRefresh,
    busy,
    onAccountChange,
    onConnect,
    onManageAccounts,
    onRefresh,
    onSettings,
  }: {
    native: boolean;
    demo: boolean;
    accounts: Account[];
    accountId: string;
    accountName: (id: string) => string;
    /** Undefined while the first snapshot loads. */
    connectivity: Snapshot['connectivity'] | undefined;
    refreshing: boolean;
    /** A snapshot is loaded; settings and the account menu wait for it. */
    ready: boolean;
    /** A snapshot is loaded or a load error invites a retry. */
    canRefresh: boolean;
    /** A settings change is running; the account stays as it is meanwhile. */
    busy: boolean;
    onAccountChange: (id: string) => void;
    onConnect: () => void;
    onManageAccounts: () => void;
    onRefresh: () => void;
    onSettings: () => void;
  } = $props();

  let accountMenu = $state<ReturnType<typeof AccountMenu>>();

  /** Moves focus to the account menu button. */
  export function focusAccount() {
    accountMenu?.focus();
  }
</script>

<!-- Natively the bar drags the window: the brand ignores the pointer, so a
     press on it or on the free space lands on the bar; controls stay clickable. -->
<header class="app-bar" data-tauri-drag-region={native ? true : undefined}>
  <h1 class="brand">
    <span class="brand-icon"><Icon name="tray" size={16} /></span><span
      class="brand-name">RepoTray</span
    >
  </h1>
  <div class="app-bar-actions">
    <AccountMenu
      bind:this={accountMenu}
      {native}
      {accounts}
      {accountId}
      {accountName}
      {connectivity}
      disabled={!ready || busy}
      onChange={onAccountChange}
      {onConnect}
      onManage={onManageAccounts}
    /><button
      class:spinning={refreshing}
      class="icon-button"
      aria-label="Aktualisieren"
      aria-keyshortcuts="F5 Control+R"
      title={`${demo ? 'Demo' : 'GitHub'}-Status aktualisieren (F5)`}
      onclick={() => onRefresh()}
      disabled={refreshing || !canRefresh}
      ><Icon name="refresh" size={17} /></button
    ><button
      class="icon-button"
      aria-label="Einstellungen"
      title="Einstellungen"
      onclick={() => onSettings()}
      disabled={!ready}><Icon name="settings" size={17} /></button
    >
  </div>
</header>
