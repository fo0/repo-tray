<script lang="ts">
  import Icon from './Icon.svelte';
  import { accountTitle } from './accountSelection';
  import type { Account } from './types';
  let {
    accounts,
    activeAccountId,
    disabled = false,
    onUse,
  }: {
    accounts: Account[];
    activeAccountId: string;
    disabled?: boolean;
    onUse: (id: string) => void;
  } = $props();
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
            >{account.id.startsWith('github-gh-')
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
      </div>
    {/each}
  </section>
{:else}
  <p class="auth-not-connected">Noch kein Konto mit RepoTray verbunden.</p>
{/if}
