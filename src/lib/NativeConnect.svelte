<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import Icon from './Icon.svelte';
  import LocalAuth from './LocalAuth.svelte';
  import BrowserAuth from './BrowserAuth.svelte';
  import type { Snapshot } from './types';
  let {
    onConnected,
    onClose,
  }: { onConnected: (snapshot: Snapshot) => void; onClose: () => void } =
    $props();
  let input = $state<HTMLInputElement>();
  let busy = $state(false);
  let localBusy = $state(false);
  let browserBusy = $state(false);
  let error = $state('');
  let active = true;
  async function connect(event: SubmitEvent) {
    event.preventDefault();
    if (busy || localBusy || browserBusy) return;
    busy = true;
    error = '';
    const token = input?.value ?? '';
    if (input) input.value = '';
    try {
      const snapshot = await invoke<Snapshot>('connect_token', { token });
      if (active) onConnected(snapshot);
    } catch (cause) {
      if (active)
        error =
          typeof cause === 'string' ? cause : 'Verbindung fehlgeschlagen.';
    } finally {
      if (active) busy = false;
    }
  }
  onDestroy(() => {
    active = false;
    if (input) input.value = '';
    void invoke('cancel_connect').catch(() => {});
  });
</script>

<form onsubmit={connect}>
  <div class="modal-body auth-preview">
    <div class="auth-symbol"><Icon name="github" size={28} /></div>
    <h3>Dein GitHub-Konto verbinden</h3>
    <BrowserAuth
      {onConnected}
      disabled={busy || localBusy}
      onBusy={(value) => (browserBusy = value)}
    />
    <div class="token-path">
      <label class="field"
        ><span>GitHub-Token</span><input
          type="password"
          aria-label="GitHub-Token"
          bind:this={input}
          autocomplete="off"
          spellcheck="false"
          maxlength="2048"
          required
          disabled={busy || localBusy || browserBusy}
        /></label
      >
      <p>
        Nur im Betriebssystem-Tresor gespeichert. Für ausgewählte Repositories:
        Actions lesen/schreiben und Contents lesen. Org-Freigaben können
        erforderlich sein. Für private App-Updates muss der Token auch
        fo0/repo-tray lesen dürfen.
      </p>
      {#if error}<div class="alert danger" role="alert">{error}</div>{/if}
      <button
        type="submit"
        class="primary-button full-width"
        disabled={busy || localBusy || browserBusy}
        >{busy ? 'Konto wird geprüft …' : 'Token prüfen und verbinden'}<Icon
          name="check"
          size={15}
        /></button
      >
    </div>
    <LocalAuth
      {onConnected}
      disabled={busy || browserBusy}
      onBusy={(value) => (localBusy = value)}
    />
  </div>
  <div class="modal-actions">
    <button type="button" class="secondary-button" onclick={onClose}
      >Abbrechen</button
    >
  </div>
</form>
