<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { call } from './ipc';
  import LocalAuth from './LocalAuth.svelte';
  import BrowserSignInUnavailable from './BrowserSignInUnavailable.svelte';
  import ConnectedAccounts from './ConnectedAccounts.svelte';
  import TokenPermissions from './TokenPermissions.svelte';
  import type { Account, Snapshot } from './types';
  let {
    onConnected,
    onClose,
    accounts = [],
    activeAccountId = '',
    onSelectAccount,
  }: {
    onConnected: (snapshot: Snapshot) => void;
    onClose: () => void;
    accounts?: Account[];
    activeAccountId?: string;
    onSelectAccount: (id: string) => void;
  } = $props();
  let input = $state<HTMLInputElement>();
  let busy = $state(false);
  let localBusy = $state(false);
  let hasToken = $state(false);
  let error = $state('');
  let active = true;
  async function connect(event: SubmitEvent) {
    event.preventDefault();
    if (busy || localBusy || !hasToken) return;
    busy = true;
    error = '';
    const token = input?.value ?? '';
    if (input) input.value = '';
    hasToken = false;
    try {
      const snapshot = await call('connect_token', { token });
      if (active) onConnected(snapshot);
    } catch (cause) {
      if (active)
        error =
          typeof cause === 'string'
            ? cause
            : 'Verbindung fehlgeschlagen. Prüfe Token und Netzwerk und versuche es erneut.';
    } finally {
      if (active) busy = false;
    }
  }
  onDestroy(() => {
    active = false;
    if (input) input.value = '';
    void call('cancel_connect').catch(() => {});
  });
</script>

<form onsubmit={connect}>
  <div class="modal-body auth-preview">
    <div class="auth-symbol"><Icon name="github" size={28} /></div>
    <h3>Dein GitHub-Konto verbinden</h3>
    <ConnectedAccounts
      {accounts}
      {activeAccountId}
      disabled={busy || localBusy}
      onUse={(id) => {
        onSelectAccount(id);
        onClose();
      }}
    />
    <BrowserSignInUnavailable />
    <LocalAuth
      {onConnected}
      disabled={busy}
      onBusy={(value) => (localBusy = value)}
      connectedAccounts={accounts}
      {activeAccountId}
      onUseAccount={(id) => {
        onSelectAccount(id);
        onClose();
      }}
    />
    <div class="token-path">
      <h4>
        {accounts.length
          ? 'Weiteres Konto per Token verbinden'
          : 'Mit einem GitHub-Token verbinden'}
      </h4>
      <label class="field"
        ><span>GitHub-Token</span><input
          type="password"
          aria-label="GitHub-Token"
          bind:this={input}
          autocomplete="off"
          spellcheck="false"
          maxlength="2048"
          required
          disabled={busy || localBusy}
          oninput={(event) =>
            (hasToken = event.currentTarget.value.trim().length > 0)}
        /></label
      >
      <p>
        Wird nur im Betriebssystem-Tresor gespeichert und hier nie angezeigt.
      </p>
      <TokenPermissions />
      {#if error}<div class="alert danger" role="alert">{error}</div>{/if}
      <button
        type="submit"
        class="primary-button full-width"
        disabled={busy || localBusy || !hasToken}
        >{busy ? 'Konto wird geprüft …' : 'Token prüfen und verbinden'}<Icon
          name="check"
          size={15}
        /></button
      >
    </div>
  </div>
  <div class="modal-actions">
    <button type="button" class="secondary-button" onclick={onClose}
      >Abbrechen</button
    >
  </div>
</form>
