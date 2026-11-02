<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import LocalAccountImport, {
    importable,
    localKey,
  } from './LocalAccountImport.svelte';
  import { ipcErrorMessage } from './format';
  import { call } from './ipc';
  import type { Account, LocalAccount, Snapshot } from './types';

  let {
    onConnected,
    onBack,
    connectedAccounts = [],
    heading = $bindable(),
  }: {
    onConnected: (snapshot: Snapshot) => void;
    /** „Zurück“ to the method choice; a running check is cancelled. */
    onBack: () => void;
    connectedAccounts?: Account[];
    /** The step heading, focused by the dialog on every step change. */
    heading?: HTMLHeadingElement | undefined;
  } = $props();
  // The method choice („Lokale Anmeldung prüfen“) was the explicit click
  // that starts this check; nothing local is read before it.
  let phase = $state<'scanning' | 'done' | 'importing'>('scanning');
  let accounts = $state<LocalAccount[]>([]);
  let ghMissing = $state(false);
  let failed = $state(false);
  let selected = $state('');
  let error = $state('');
  let active = true;
  let generation = 0;
  /** Plain flag: a teardown reads state as it was before the close. */
  let inFlight = false;
  const usable = $derived(accounts.filter(importable));
  const chosen = $derived(usable.find((a) => localKey(a) === selected));
  /** „Übernehmen“ needs a chosen account; nothing runs twice. */
  const blocked = $derived(phase !== 'done' || (usable.length > 0 && !chosen));
  const connectedGh = $derived(
    connectedAccounts.filter((account) => account.id.startsWith('github-gh-')),
  );

  async function scan() {
    const ticket = ++generation;
    inFlight = true;
    phase = 'scanning';
    failed = false;
    error = '';
    selected = '';
    accounts = [];
    ghMissing = false;
    try {
      const result = await call('discover_local_auth');
      if (!active || ticket !== generation) return;
      accounts = result.accounts;
      ghMissing = result.notices.some((n) => n.startsWith('gh CLI nicht'));
      const found = result.accounts.filter(importable);
      if (found.length === 1 && found[0]) selected = localKey(found[0]);
    } catch (cause) {
      if (!active || ticket !== generation) return;
      failed = true;
      error = ipcErrorMessage(cause, 'Prüfung fehlgeschlagen.');
    } finally {
      if (ticket === generation) inFlight = false;
      if (active && ticket === generation) phase = 'done';
    }
  }
  async function connect() {
    if (phase !== 'done' || !chosen) return;
    const ticket = ++generation;
    inFlight = true;
    phase = 'importing';
    error = '';
    try {
      const snapshot = await call('connect_local_auth', {
        login: chosen.login,
        confirmImport: true,
      });
      if (active && ticket === generation) onConnected(snapshot);
    } catch (cause) {
      if (active && ticket === generation)
        error = ipcErrorMessage(cause, 'Übernahme fehlgeschlagen.');
    } finally {
      if (ticket === generation) inFlight = false;
      if (active && ticket === generation) phase = 'done';
    }
  }
  function primary() {
    if (blocked) return;
    void (usable.length ? connect() : scan());
  }
  /** The in-list rescan disappears while it runs; focus waits on the heading. */
  function rescan() {
    if (phase !== 'done') return;
    heading?.focus();
    void scan();
  }
  onMount(() => void scan());
  onDestroy(() => {
    active = false;
    generation++;
    // Leaving mid-check or mid-import discards its late result.
    if (inFlight) void call('cancel_connect').catch(() => {});
  });
</script>

<div class="modal-body connect-step" aria-busy={phase !== 'done'}>
  <h3 id="connect-step-title" tabindex="-1" bind:this={heading}>
    Anmeldung von diesem PC
  </h3>
  <div aria-live="polite">
    {#if phase === 'scanning'}
      <p class="step-line">GitHub CLI wird geprüft …</p>
    {:else if failed}
      <div class="alert warning" role="alert">{error}</div>
    {:else}
      {#if !usable.length}<p class="step-line">
          {ghMissing
            ? 'GitHub CLI (gh) nicht gefunden. Nach der Installation RepoTray neu starten.'
            : 'Keine gh-Anmeldung gefunden. Im Terminal mit „gh auth login“ anmelden.'}
        </p>{/if}
      {#if accounts.length}<LocalAccountImport
          {accounts}
          connected={connectedGh}
          bind:selected
          disabled={phase !== 'done'}
        />{/if}
      {#if error}<div class="alert warning" role="alert">{error}</div>{/if}
      {#if usable.length}<button
          type="button"
          class="text-button rescan"
          aria-disabled={phase !== 'done' ? 'true' : undefined}
          onclick={rescan}>Erneut prüfen</button
        >{/if}
    {/if}
  </div>
</div>
<div class="modal-actions">
  <button type="button" class="secondary-button" onclick={onBack}>Zurück</button
  ><!-- One element for every phase, off via aria-disabled: it keeps focus. --><button
    type="button"
    class="primary-button"
    aria-disabled={blocked ? 'true' : undefined}
    title={phase === 'done' && blocked ? 'Konto auswählen' : undefined}
    aria-describedby={chosen ? 'local-consent' : undefined}
    onclick={primary}
    >{phase === 'scanning'
      ? 'Wird geprüft …'
      : phase === 'importing'
        ? 'Wird übernommen …'
        : usable.length
          ? 'Übernehmen'
          : 'Erneut prüfen'}</button
  >
</div>
