<script lang="ts">
  import Icon from './Icon.svelte';
  import { avatarLetter, plural } from './format';
  import type { Account } from './types';

  let {
    native,
    demo,
    accounts,
    accountId,
    accountLabel,
    repoCount,
    refreshing,
    ready,
    onAccountChange,
    onRefresh,
    onSettings,
  }: {
    native: boolean;
    demo: boolean;
    accounts: Account[];
    accountId: string;
    /** Display name of the active account (native status chip). */
    accountLabel: string;
    repoCount: number;
    refreshing: boolean;
    /** A snapshot is loaded; refresh and settings stay disabled until then. */
    ready: boolean;
    onAccountChange: (id: string) => void;
    onRefresh: () => void;
    onSettings: () => void;
  } = $props();

  let picker = $state<HTMLSelectElement>();
  const avatar = $derived(
    avatarLetter(
      accounts.find((account) => account.id === accountId)?.login,
      'A',
    ),
  );

  /** Browser demo only: native picks the account in the settings dialog. */
  export function focusPicker() {
    picker?.focus();
  }
</script>

<div class="toolbar">
  {#if native}
    <div class="active-account-status" role="status" aria-label="Aktives Konto">
      <button
        class="account-chip"
        aria-label={`${accountId ? `Konto: ${accountLabel}` : 'Kein aktives Konto'} – Einstellungen öffnen`}
        title={accountId
          ? `Aktives Konto: ${accountLabel} · Konten in den Einstellungen`
          : 'Kein aktives Konto · Auswahl in den Einstellungen'}
        onclick={() => onSettings()}
        disabled={!ready}
        ><Icon name="github" size={14} /><span
          >{accountId ? accountLabel : 'Kein aktives Konto'}</span
        ></button
      >
    </div>
  {:else}
    <label class="account-picker"
      ><span class="avatar">{avatar}</span><select
        aria-label="Konto auswählen"
        bind:this={picker}
        value={accountId}
        onchange={(event) => onAccountChange(event.currentTarget.value)}
        ><option value="">Alle Konten</option
        >{#each accounts as account (account.id)}<option value={account.id}
            >{account.login}</option
          >{/each}</select
      ><Icon name="down" size={13} /></label
    >
  {/if}
  <div class="toolbar-actions">
    <span class="repo-count"
      >{plural(repoCount, 'Repository', 'Repositories')}</span
    ><button
      class:spinning={refreshing}
      class="icon-button"
      aria-label="Aktualisieren"
      aria-keyshortcuts="F5 Control+R"
      title={`${demo ? 'Demo' : 'GitHub'}-Status aktualisieren (F5)`}
      onclick={() => onRefresh()}
      disabled={refreshing || !ready}><Icon name="refresh" size={16} /></button
    ><button
      class="icon-button"
      aria-label="Einstellungen"
      title="Einstellungen"
      onclick={() => onSettings()}
      disabled={!ready}><Icon name="settings" size={17} /></button
    >
  </div>
</div>
