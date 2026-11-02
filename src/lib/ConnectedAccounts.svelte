<script lang="ts">
  import { tick } from 'svelte';
  import InlineConfirm from './InlineConfirm.svelte';
  import { accountTitle } from './accountSelection';
  import type { Account, UncertainStart } from './types';
  let {
    accounts,
    activeAccountId,
    choice,
    uncertainStarts = [],
    disabled = false,
    onChoose,
    onDisconnect,
  }: {
    accounts: Account[];
    /** The account in effect; tagged „Aktiv“. */
    activeAccountId: string;
    /** The checked account: staged, applied only by „Speichern“. */
    choice: string;
    /** Locked starts; disconnecting their account releases the lock. */
    uncertainStarts?: UncertainStart[] | undefined;
    disabled?: boolean;
    onChoose: (id: string) => void;
    /**
     * „Trennen“ acts at once after the confirmation inside the card. Resolves
     * once the disconnect settled; the caller moves focus when the card is gone.
     */
    onDisconnect: (id: string) => Promise<unknown>;
  } = $props();
  let confirming = $state<string | null>(null);
  /** Elements by account; reactive, as `bind:this` requires. */
  const triggers = $state<Record<string, HTMLButtonElement | undefined>>({});
  const radios = $state<Record<string, HTMLInputElement | undefined>>({});
  const imported = (account: Account) => account.id.startsWith('github-gh-');
  const locked = (account: Account) =>
    uncertainStarts.some((start) => start.accountId === account.id);
  /** One sentence: what the vault and cache delete, and a released lock. */
  const consequence = (account: Account) =>
    `Zugang, Repository-Auswahl und Favoriten werden gelöscht${imported(account) ? ', gh bleibt angemeldet' : ''}${locked(account) ? ';' : '.'}`;

  /** Focuses the checked account, else the first one. */
  export function focusChoice() {
    (radios[choice] ?? radios[accounts[0]?.id ?? ''])?.focus();
  }
  async function focusTrigger(id: string) {
    await tick();
    triggers[id]?.focus();
  }
  function cancel(id: string) {
    confirming = null;
    void focusTrigger(id);
  }
  async function disconnect(id: string) {
    await onDisconnect(id);
    confirming = null;
    // A failed disconnect keeps the card; its trigger takes focus back.
    if (accounts.some((account) => account.id === id)) void focusTrigger(id);
  }
</script>

<div
  class="connected-auth"
  role="radiogroup"
  aria-labelledby="active-account-heading"
>
  {#each accounts as account (account.id)}
    <div class="connected-auth-card" class:active={account.id === choice}>
      <label class="account-choice">
        <input
          type="radio"
          name="active-account"
          value={account.id}
          checked={account.id === choice}
          bind:this={radios[account.id]}
          aria-describedby={account.id === activeAccountId
            ? `account-tag-${account.id}`
            : undefined}
          {disabled}
          onchange={() => onChoose(account.id)}
        />
        <strong>{accountTitle(account)}</strong>
      </label>
      {#if account.id === activeAccountId}<span
          class="account-tag"
          id={`account-tag-${account.id}`}>Aktiv</span
        >{/if}
      {#if confirming !== account.id}<button
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
          warning={locked(account)
            ? 'ungeklärte Starts sind danach nicht mehr gesperrt.'
            : undefined}
          confirmLabel="Trennen"
          busyLabel="Wird getrennt …"
          busy={disabled}
          onConfirm={() => void disconnect(account.id)}
          onCancel={() => cancel(account.id)}
        />{/if}
    </div>
  {/each}
</div>
