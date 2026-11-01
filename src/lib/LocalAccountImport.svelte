<script lang="ts">
  import Icon from './Icon.svelte';
  import type { Account, LocalAccount } from './types';

  let {
    account,
    imported,
    activeAccountId,
    busy,
    disabled,
    importing,
    consent = $bindable(),
    onConnect,
    onUseAccount,
  }: {
    /** The chosen, usable gh account. */
    account: LocalAccount;
    /** Its RepoTray copy when it was connected before. */
    imported: Account | undefined;
    activeAccountId: string;
    busy: boolean;
    disabled: boolean;
    importing: boolean;
    consent: boolean;
    onConnect: () => void;
    onUseAccount: (id: string) => void;
  } = $props();
</script>

<p class="local-source-status" role="status">
  <Icon name="check" size={15} />{imported
    ? imported.id === activeAccountId
      ? 'In RepoTray verbunden · aktives Konto'
      : 'In RepoTray verbunden · noch nicht aktiv'
    : 'In gh erkannt · noch nicht mit RepoTray verbunden'}
</p>
{#if imported && imported.id !== activeAccountId}<button
    type="button"
    class="secondary-button"
    disabled={busy || disabled}
    onclick={() => onUseAccount(imported.id)}
    >Als aktives Konto verwenden</button
  >{/if}
<p>
  <strong>{account.login} · {account.host} · gh CLI</strong><br
  />{account.detail}
</p>
<p class="field-help">
  {account.actionsRead}<br />{account.actionsWrite}
</p>
<label class="import-consent"
  ><input
    type="checkbox"
    bind:checked={consent}
    disabled={busy || disabled}
  />Ich möchte dieses gh-Konto in RepoTray verwenden</label
>
<p class="field-help">
  RepoTray speichert dafür eine eigene Token-Kopie im Betriebssystem-Tresor.
  Deine gh-Anmeldung bleibt erhalten. Erst Verbinden übernimmt das Konto in
  RepoTray; Trennen entfernt nur diese Kopie.
</p>
<button
  type="button"
  class="primary-button full-width"
  disabled={busy || disabled || !consent}
  onclick={onConnect}
  >{importing && busy
    ? 'Konto wird verbunden …'
    : imported
      ? 'gh-Konto erneut übernehmen'
      : 'gh-Konto mit RepoTray verbinden'}</button
>

<style>
  .local-source-status {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 9px;
    border: 1px solid #607f46;
    border-radius: 6px;
    background: #304027;
    color: #d2e3c5;
  }
  .import-consent {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: var(--font-size-meta);
  }
  .import-consent input {
    margin-top: 0.2rem;
    flex-shrink: 0;
  }
</style>
