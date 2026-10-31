<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import Icon from './Icon.svelte';
  import type { Snapshot } from './types';
  type Account = {
    source: 'gh' | 'gcm';
    host: string;
    login: string;
    usable: boolean;
    active: boolean;
    detail: string;
    actionsRead: string;
    actionsWrite: string;
  };
  let {
    onConnected,
    onBusy,
    disabled = false,
  }: {
    onConnected: (snapshot: Snapshot) => void;
    onBusy: (busy: boolean) => void;
    disabled?: boolean;
  } = $props();
  let accounts = $state<Account[]>([]);
  let notices = $state<string[]>([]);
  let selected = $state('');
  let consent = $state(false);
  let busy = $state(false);
  let checked = $state(false);
  let expanded = $state(false);
  let error = $state('');
  let active = true;
  let generation = 0;
  const chosen = $derived(
    accounts.find((a) => a.source === 'gh' && a.login === selected && a.usable),
  );
  function setBusy(value: boolean) {
    busy = value;
    onBusy(value);
  }
  async function scan() {
    if (busy || disabled) return;
    const ticket = ++generation;
    setBusy(true);
    error = '';
    consent = false;
    selected = '';
    accounts = [];
    notices = [];
    try {
      const result = await invoke<{ accounts: Account[]; notices: string[] }>(
        'discover_local_auth',
      );
      if (!active || ticket !== generation) return;
      accounts = result.accounts;
      notices = result.notices;
      checked = true;
      const usable = accounts.filter((a) => a.usable && a.source === 'gh');
      if (usable.length === 1) selected = usable[0].login;
    } catch {
      if (active && ticket === generation)
        error =
          'Lokale Anmeldung konnte nicht geprüft werden. Erneut versuchen.';
    } finally {
      if (active && ticket === generation) setBusy(false);
    }
  }
  async function connect() {
    if (busy || disabled || !chosen || !consent) return;
    const ticket = ++generation;
    setBusy(true);
    error = '';
    try {
      const snapshot = await invoke<Snapshot>('connect_local_auth', {
        login: chosen.login,
        confirmImport: true,
      });
      if (active && ticket === generation) onConnected(snapshot);
    } catch {
      if (active && ticket === generation)
        error =
          'Lokale Anmeldung nicht übernommen. Konto, Netzwerk oder Betriebssystem-Tresor prüfen und erneut suchen.';
    } finally {
      if (active && ticket === generation) setBusy(false);
    }
  }
  function cancel() {
    generation++;
    setBusy(false);
    consent = false;
    void invoke('cancel_connect').catch(() => {});
  }
  onDestroy(() => {
    active = false;
    generation++;
    onBusy(false);
    if (busy) void invoke('cancel_connect').catch(() => {});
  });
</script>

<div class="token-path local-auth">
  <button
    type="button"
    class="secondary-button full-width local-method-toggle"
    aria-label="Bestehende Anmeldung auf diesem PC verwenden"
    aria-describedby="local-auth-method-hint"
    aria-expanded={expanded}
    aria-controls="local-auth-options"
    {disabled}
    onclick={() => {
      expanded = !expanded;
      if (!expanded && busy) cancel();
    }}
  >
    <Icon name="computer" size={21} />
    <span class="local-method-copy">
      <strong>Bestehende Anmeldung auf diesem PC verwenden</strong>
      <small id="local-auth-method-hint"
        >Anmeldeoption · gespeicherte gh-Konten</small
      >
    </span>
    <span class="local-method-chevron" class:open={expanded}
      ><Icon name="down" size={16} /></span
    >
  </button>
  <div id="local-auth-options" hidden={!expanded}>
    <p>
      Prüfe gespeicherte Konten der gh CLI und Git Credential Manager. Erst
      dieser Klick greift auf lokale Anmeldungen zu. Unterstützt wird
      GitHub.com.
    </p>
    <button
      type="button"
      class="secondary-button"
      disabled={busy || disabled}
      onclick={scan}
    >
      {busy
        ? 'Lokale Anmeldung wird geprüft …'
        : checked
          ? 'Erneut prüfen'
          : 'Lokale Anmeldungen prüfen'}
    </button>
    {#if busy}<button type="button" class="text-button" onclick={cancel}
        >Prüfung abbrechen</button
      >{/if}
    <div aria-live="polite">
      {#if checked}
        {#if accounts.some((a) => a.usable && a.source === 'gh')}
          <label class="field"
            ><span>Lokales Konto · gh CLI</span>
            <select
              bind:value={selected}
              disabled={busy || disabled}
              onchange={() => (consent = false)}
            >
              <option value="">Konto auswählen</option>
              {#each accounts.filter((a) => a.usable && a.source === 'gh') as account}
                <option value={account.login}
                  >{account.login} · {account.host}{account.active
                    ? ' · in gh aktiv'
                    : ''}</option
                >
              {/each}
            </select>
          </label>
        {:else}<p>Keine geeignete lokale API-Anmeldung verfügbar.</p>{/if}
        {#if chosen}
          <p>
            <strong>{chosen.login} · {chosen.host} · gh CLI</strong><br
            />{chosen.detail}
          </p>
          <p class="field-help">
            {chosen.actionsRead}<br />{chosen.actionsWrite}
          </p>
          <label class="import-consent"
            ><input
              type="checkbox"
              bind:checked={consent}
              disabled={busy || disabled}
            />Token als eigene RepoTray-Kopie im Betriebssystem-Tresor speichern</label
          >
          <p class="field-help">
            Die gh-Anmeldung bleibt verwaltet durch gh. Trennen entfernt nur die
            RepoTray-Kopie. Kein neues Login, Kontowechsel oder automatisches
            Erweitern der Rechte.
          </p>
          <button
            type="button"
            class="primary-button full-width"
            disabled={busy || disabled || !consent}
            onclick={connect}>Ausgewähltes Konto prüfen und übernehmen</button
          >
        {/if}
        {#each accounts.filter((a) => !a.usable) as account}
          <p class="field-help">
            <strong
              >{account.login} · {account.host} · {account.source === 'gcm'
                ? 'GCM'
                : 'gh CLI'}</strong
            ><br />{account.detail}<br />{account.actionsRead}
            {account.actionsWrite}
          </p>
        {/each}
        <details>
          <summary>Weitere lokale Quellen</summary>{#each notices as notice}<p
              class="field-help"
            >
              {notice}
            </p>{/each}
        </details>
      {/if}
      {#if error}<div class="alert warning" role="alert">{error}</div>{/if}
    </div>
  </div>
</div>

<style>
  .local-auth {
    text-align: left;
  }
  .local-auth .local-method-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 54px;
    margin-top: 0;
    padding: 10px 12px;
    border: 1px solid #627b4b;
    background: #2b3b25;
    color: #d2e3c5;
    text-align: left;
    white-space: normal;
    justify-content: flex-start;
  }
  .local-method-toggle > :global(svg) {
    flex-shrink: 0;
  }
  .local-method-toggle:hover:not(:disabled) {
    border-color: #9ac572;
    background: #34472c;
  }
  .local-method-toggle:focus-visible {
    outline: 2px solid #b7df89;
    outline-offset: 3px;
  }
  .local-method-copy {
    min-width: 0;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
  }
  .local-method-copy strong {
    font-size: 11px;
    font-weight: 600;
    line-height: 1.45;
  }
  .local-method-copy small {
    color: #a9bd98;
    font-size: 10px;
    line-height: 1.4;
  }
  .local-method-chevron {
    display: flex;
    flex-shrink: 0;
  }
  .local-method-chevron.open {
    transform: rotate(180deg);
  }
  .local-auth p {
    margin: 0.65rem 0;
  }
  .import-consent {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.8rem;
  }
  .import-consent input {
    margin-top: 0.2rem;
    flex-shrink: 0;
  }
  select {
    width: 100%;
  }
</style>
