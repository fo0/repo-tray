<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import InlineConfirm from './InlineConfirm.svelte';
  import { accountTitle } from './accountSelection';
  import type { Account, UncertainStart } from './types';
  let {
    accounts,
    activeAccountId,
    uncertainStarts = [],
    disabled = false,
    onUse,
    onDisconnect,
  }: {
    accounts: Account[];
    activeAccountId: string;
    /** Locked starts; disconnecting their account releases the lock. */
    uncertainStarts?: UncertainStart[];
    disabled?: boolean;
    onUse: (id: string) => void;
    /**
     * Offers „Trennen“ on every card, confirmed inside that card. Resolves once
     * the disconnect settled; the caller moves focus when the card is gone.
     */
    onDisconnect?: (id: string) => Promise<unknown>;
  } = $props();
  let confirming = $state<string | null>(null);
  const triggers: Record<string, HTMLButtonElement | undefined> = {};
  const imported = (account: Account) => account.id.startsWith('github-gh-');
  /** What a disconnect deletes, as the vault and cache delete it. */
  const consequence = (account: Account) =>
    `Gespeicherter Zugang, Repository-Auswahl und Favoriten dieses Kontos werden gelöscht.${imported(account) ? ' Der gh-CLI-Zugang selbst bleibt unberührt.' : ''}`;
  const unresolved = (account: Account) =>
    uncertainStarts.some((start) => start.accountId === account.id)
      ? 'Achtung: Für dieses Konto gibt es ungeklärte Starts. Nach dem Trennen sind sie nicht mehr gesperrt – prüfe die Runs auf GitHub vorher.'
      : undefined;

  async function focusTrigger(id: string) {
    await tick();
    triggers[id]?.focus();
  }
  function cancel(id: string) {
    confirming = null;
    void focusTrigger(id);
  }
  async function disconnect(id: string) {
    await onDisconnect?.(id);
    confirming = null;
    // A failed disconnect keeps the card; its trigger takes focus back.
    if (accounts.some((account) => account.id === id)) void focusTrigger(id);
  }
</script>

{#if accounts.length}
  <section class="connected-auth" aria-label="Verbundene Anmeldungen">
    <h4>Bereits in RepoTray verbunden</h4>
    {#each accounts as account (account.id)}
      <div
        class="connected-auth-card"
        class:active={account.id === activeAccountId}
      >
        <Icon name="check" size={17} />
        <div>
          <strong>{accountTitle(account)}</strong>
          <span
            >{imported(account)
              ? 'gh-Anmeldung übernommen'
              : account.id.startsWith('github-device-')
                ? 'Browser-Anmeldung gespeichert'
                : 'Token hinterlegt'} · {account.id === activeAccountId
              ? 'Aktiv für RepoTray'
              : 'Verbunden, nicht aktiv'}</span
          >
        </div>
        {#if account.id !== activeAccountId}<button
            type="button"
            class="text-button"
            {disabled}
            onclick={() => onUse(account.id)}
            aria-label={`${accountTitle(account)} für RepoTray verwenden`}
            >Verwenden</button
          >{/if}
        {#if onDisconnect && confirming !== account.id}<button
            type="button"
            class="text-button danger-text"
            bind:this={triggers[account.id]}
            disabled={disabled || confirming !== null}
            onclick={() => (confirming = account.id)}
            aria-label={`${accountTitle(account)} trennen`}>Trennen</button
          >{/if}
        {#if confirming === account.id}<InlineConfirm
            id={`disconnect-${account.id}`}
            title={`${accountTitle(account)} trennen?`}
            text={consequence(account)}
            warning={unresolved(account)}
            confirmLabel="Trennen"
            busyLabel="Wird getrennt …"
            busy={disabled}
            onConfirm={() => void disconnect(account.id)}
            onCancel={() => cancel(account.id)}
          />{/if}
      </div>
    {/each}
  </section>
{/if}
