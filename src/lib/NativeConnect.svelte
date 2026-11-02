<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import ConnectMethods, { type ConnectMethod } from './ConnectMethods.svelte';
  import LocalAuth from './LocalAuth.svelte';
  import TokenPermissions from './TokenPermissions.svelte';
  import { ipcErrorMessage } from './format';
  import { call } from './ipc';
  import type { Account, Snapshot } from './types';

  let {
    onConnected,
    onClose,
    accounts = [],
  }: {
    /** A connection succeeded; the caller closes this dialog. */
    onConnected: (snapshot: Snapshot) => void;
    onClose: () => void;
    /** Connected accounts; marks gh logins that RepoTray already holds. */
    accounts?: Account[];
  } = $props();

  // One step at a time: choose a method, then exactly one form for it.
  let step = $state<'choose' | ConnectMethod>('choose');
  let method = $state<ConnectMethod>('local');
  let heading = $state<HTMLHeadingElement>();
  let input = $state<HTMLInputElement>();
  let busy = $state(false);
  let hasToken = $state(false);
  let error = $state('');
  let active = true;
  let generation = 0;

  // Each step announces itself: its heading takes focus.
  $effect(() => {
    const current = step;
    void tick().then(() => {
      if (step === current) heading?.focus();
    });
  });

  function back() {
    if (busy) {
      generation++;
      busy = false;
      void call('cancel_connect').catch(() => {});
    }
    if (input) input.value = '';
    hasToken = false;
    error = '';
    step = 'choose';
  }
  async function connect(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !hasToken) return;
    const ticket = ++generation;
    busy = true;
    error = '';
    const token = input?.value ?? '';
    if (input) input.value = '';
    hasToken = false;
    try {
      const snapshot = await call('connect_token', { token });
      if (active && ticket === generation) onConnected(snapshot);
    } catch (cause) {
      if (active && ticket === generation)
        error = ipcErrorMessage(
          cause,
          'Verbindung fehlgeschlagen. Token und Netzwerk prüfen.',
        );
    } finally {
      if (active && ticket === generation) busy = false;
    }
  }
  onDestroy(() => {
    active = false;
    if (input) input.value = '';
    void call('cancel_connect').catch(() => {});
  });
</script>

{#if step === 'choose'}
  <div class="modal-body connect-step">
    <h3 id="connect-step-title" tabindex="-1" bind:this={heading}>
      Anmeldeart wählen
    </h3>
    <ConnectMethods bind:value={method} />
  </div>
  <div class="modal-actions">
    <button type="button" class="secondary-button" onclick={onClose}
      >Abbrechen</button
    >
    <button type="button" class="primary-button" onclick={() => (step = method)}
      >{method === 'local' ? 'Lokale Anmeldung prüfen' : 'Weiter'}</button
    >
  </div>
{:else if step === 'local'}
  <LocalAuth
    connectedAccounts={accounts}
    {onConnected}
    onBack={back}
    bind:heading
  />
{:else}
  <form onsubmit={connect}>
    <div class="modal-body connect-step">
      <h3 id="connect-step-title" tabindex="-1" bind:this={heading}>
        Mit Token verbinden
      </h3>
      <label class="field"
        ><span>GitHub-Token</span><input
          type="password"
          aria-label="GitHub-Token"
          aria-describedby="token-permissions"
          bind:this={input}
          autocomplete="off"
          spellcheck="false"
          maxlength="2048"
          readonly={busy}
          oninput={(event) =>
            (hasToken = event.currentTarget.value.trim().length > 0)}
        /></label
      >
      <TokenPermissions />
      {#if error}<div class="alert danger" role="alert">{error}</div>{/if}
    </div>
    <div class="modal-actions">
      <button type="button" class="secondary-button" onclick={back}
        >Zurück</button
      >
      <!-- Off via aria-disabled: a running check keeps focus here. -->
      <button
        type="submit"
        class="primary-button"
        aria-disabled={busy || !hasToken ? 'true' : undefined}
        title={busy || hasToken ? undefined : 'Token eingeben'}
        >{busy ? 'Wird geprüft …' : 'Verbinden'}</button
      >
    </div>
  </form>
{/if}
