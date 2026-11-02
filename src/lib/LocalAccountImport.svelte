<script module lang="ts">
  import type { LocalAccount } from './types';

  /** One radio value per found entry; gh and GCM may share a login. */
  export const localKey = (account: LocalAccount) =>
    `${account.source}:${account.login}`;
  /** Only gh entries carry an API sign-in RepoTray can import. */
  export const importable = (account: LocalAccount) =>
    account.source === 'gh' && account.usable;
</script>

<script lang="ts">
  import type { Account } from './types';

  let {
    accounts,
    connected,
    selected = $bindable(),
    disabled,
  }: {
    /** Every entry the discovery found, importable or not. */
    accounts: LocalAccount[];
    /** gh accounts RepoTray already holds a copy of. */
    connected: Account[];
    /** `localKey` of the chosen entry, or ''. */
    selected: string;
    disabled: boolean;
  } = $props();
  const chosen = $derived(
    accounts.find((a) => importable(a) && localKey(a) === selected),
  );
  const known = (account: LocalAccount) =>
    connected.some(
      (item) => item.login.toLowerCase() === account.login.toLowerCase(),
    );
  const source = (account: LocalAccount) =>
    `${account.source === 'gcm' ? 'Git Credential Manager' : 'GitHub CLI'}${
      !importable(account)
        ? ' · nicht übernehmbar'
        : known(account)
          ? ' · bereits verbunden'
          : ''
    }`;
</script>

<div class="choice-list" role="radiogroup" aria-label="Gefundene Konten">
  {#each accounts as account, index (index)}
    <label class="choice-card compact">
      <input
        type="radio"
        name="local-account"
        value={localKey(account)}
        disabled={disabled || !importable(account)}
        bind:group={selected}
      />
      <span
        ><strong>{account.login}</strong><small>{source(account)}</small></span
      >
    </label>
  {/each}
</div>
<!-- Consent: only the click on „Übernehmen“ right below imports this token. -->
{#if chosen}<p class="consent-line" id="local-consent">
    Das Token von <strong>{chosen.login}</strong> wird aus der GitHub CLI übernommen
    und im Windows-Tresor gespeichert.
  </p>{/if}
