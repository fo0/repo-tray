<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import Icon from './Icon.svelte';
  import { plural } from './format';
  import type { Account as ConnectedAccount, Snapshot } from './types';
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
    connectedAccounts = [],
    activeAccountId = '',
    onUseAccount,
  }: {
    onConnected: (snapshot: Snapshot) => void;
    onBusy: (busy: boolean) => void;
    disabled?: boolean;
    connectedAccounts?: ConnectedAccount[];
    activeAccountId?: string;
    onUseAccount: (id: string) => void;
  } = $props();
  let accounts = $state<Account[]>([]);
  let notices = $state<string[]>([]);
  let selected = $state('');
  let consent = $state(false);
  let busy = $state(false);
  let checked = $state(false);
  let expanded = $state(false);
  let error = $state('');
  let importing = $state(false);
  let active = true;
  let generation = 0;
  const chosen = $derived(
    accounts.find((a) => a.source === 'gh' && a.login === selected && a.usable),
  );
  const connectedGh = $derived(
    connectedAccounts.filter((account) => account.id.startsWith('github-gh-')),
  );
  const chosenImported = $derived(
    connectedGh.find(
      (account) => account.login.toLowerCase() === chosen?.login.toLowerCase(),
    ),
  );
  function setBusy(value: boolean) {
    busy = value;
    onBusy(value);
  }
  async function scan() {
    if (busy || disabled) return;
    const ticket = ++generation;
    setBusy(true);
    importing = false;
    checked = false;
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
    } catch (cause) {
      if (active && ticket === generation)
        error =
          typeof cause === 'string'
            ? cause
            : 'Lokale Anmeldung konnte nicht geprüft werden. Versuche es erneut.';
    } finally {
      if (active && ticket === generation) setBusy(false);
    }
  }
  async function connect() {
    if (busy || disabled || !chosen || !consent) return;
    const ticket = ++generation;
    setBusy(true);
    importing = true;
    error = '';
    try {
      const snapshot = await invoke<Snapshot>('connect_local_auth', {
        login: chosen.login,
        confirmImport: true,
      });
      if (active && ticket === generation) onConnected(snapshot);
    } catch (cause) {
      if (active && ticket === generation)
        error =
          typeof cause === 'string'
            ? cause
            : 'Lokale Anmeldung wurde nicht übernommen. Prüfe Konto, Netzwerk und Betriebssystem-Tresor und suche erneut.';
    } finally {
      if (active && ticket === generation) setBusy(false);
    }
  }
  function cancel() {
    generation++;
    setBusy(false);
    consent = false;
    checked = false;
    selected = '';
    accounts = [];
    notices = [];
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
        >{connectedGh.length
          ? `${plural(connectedGh.length, 'gh-Konto', 'gh-Konten')} in RepoTray verbunden`
          : 'Noch kein gh-Konto in RepoTray verbunden'}</small
      >
    </span>
    <span class="local-method-chevron" class:open={expanded}
      ><Icon name="down" size={16} /></span
    >
  </button>
  <div id="local-auth-options" hidden={!expanded}>
    <p>
      Nutze deine Anmeldung in der GitHub CLI (gh). Suchen allein verbindet noch
      kein Konto und ändert dein aktives RepoTray-Konto nicht.
    </p>
    <ol class="local-auth-steps" aria-label="Lokale Anmeldung verbinden">
      <li class:done={checked}>1 · Konten suchen</li>
      <li class:done={!!chosen}>2 · Konto auswählen</li>
      <li class:done={!!chosenImported}>3 · Verbinden</li>
    </ol>
    <button
      type="button"
      class="secondary-button"
      disabled={busy || disabled}
      onclick={scan}
    >
      {busy
        ? importing
          ? 'Konto wird übernommen …'
          : 'Lokale Anmeldung wird geprüft …'
        : checked
          ? 'Erneut prüfen'
          : 'Lokale Anmeldungen prüfen'}
    </button>
    {#if busy}<button type="button" class="text-button" onclick={cancel}
        >Prüfung abbrechen</button
      >{/if}
    <div aria-live="polite">
      {#if checked}
        {#each notices.filter((notice) => notice.startsWith('gh ') || notice.startsWith('Diese gh')) as notice}<p
            class="field-help"
          >
            {notice}
          </p>{/each}
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
        {:else}<p>
            Keine nutzbare gh-Anmeldung gefunden. Melde dich mit „gh auth login“
            an und prüfe erneut. Alternativ verbindest du dich unten mit einem
            Token.
          </p>{/if}
        {#if chosen}
          <p class="local-source-status" role="status">
            <Icon name="check" size={15} />{chosenImported
              ? chosenImported.id === activeAccountId
                ? 'In RepoTray verbunden · aktives Konto'
                : 'In RepoTray verbunden · noch nicht aktiv'
              : 'In gh erkannt · noch nicht mit RepoTray verbunden'}
          </p>
          {#if chosenImported && chosenImported.id !== activeAccountId}<button
              type="button"
              class="secondary-button"
              disabled={busy || disabled}
              onclick={() => onUseAccount(chosenImported.id)}
              >Als aktives Konto verwenden</button
            >{/if}
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
            />Ich möchte dieses gh-Konto in RepoTray verwenden</label
          >
          <p class="field-help">
            RepoTray speichert dafür eine eigene Token-Kopie im
            Betriebssystem-Tresor. Deine gh-Anmeldung bleibt erhalten. Erst
            Verbinden übernimmt das Konto in RepoTray; Trennen entfernt nur
            diese Kopie.
          </p>
          <button
            type="button"
            class="primary-button full-width"
            disabled={busy || disabled || !consent}
            onclick={connect}
            >{importing && busy
              ? 'Konto wird verbunden …'
              : chosenImported
                ? 'gh-Konto erneut übernehmen'
                : 'gh-Konto mit RepoTray verbinden'}</button
          >
        {/if}
        {#if accounts.some((a) => !a.usable)}<p class="field-help">
            Diese Anmeldungen kann RepoTray nicht übernehmen. Melde dich dafür
            mit „gh auth login“ in der GitHub CLI an oder verbinde dich unten
            mit einem Token.
          </p>{/if}
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
    <details class="local-auth-help">
      <summary>gh wird nicht erkannt oder du bist unsicher?</summary>
      <p>
        Git und GitHub CLI (gh) sind verschiedene Programme. Eine
        Git-/SSH-Anmeldung allein kann RepoTray nicht für die GitHub-API nutzen.
      </p>
      <ol>
        <li>Prüfe im Terminal <code>gh --version</code>.</li>
        <li>
          Prüfe deine Anmeldung mit <code
            >gh auth status --hostname github.com</code
          >.
        </li>
        <li>
          Falls du noch nicht angemeldet bist: <code
            >gh auth login --hostname github.com</code
          >.
        </li>
        <li>
          Starte RepoTray nach einer neuen gh-Installation neu und klicke hier
          auf „Lokale Anmeldungen prüfen“.
        </li>
      </ol>
      <p>
        Erkannte gh-Konten werden erst nach deiner Bestätigung mit RepoTray
        verbunden.
      </p>
    </details>
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
    font-size: var(--font-size-meta);
    font-weight: 600;
    line-height: 1.45;
  }
  .local-method-copy small {
    color: #a9bd98;
    font-size: var(--font-size-meta);
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
    font-size: var(--font-size-meta);
  }
  .import-consent input {
    margin-top: 0.2rem;
    flex-shrink: 0;
  }
  select {
    width: 100%;
  }
  .local-auth-steps {
    display: flex;
    gap: 8px;
    padding: 0;
    margin: 14px 0;
    list-style: none;
    font-size: var(--font-size-meta);
    color: #a5b398;
  }
  .local-auth-steps li {
    flex: 1;
    border-top: 2px solid #435638;
    padding-top: 6px;
  }
  .local-auth-steps .done {
    border-color: #b7df89;
    color: #d2e3c5;
  }
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
  .local-auth-help {
    margin-top: 14px;
    font-size: var(--font-size-meta);
    line-height: 1.65;
    color: #a9bd98;
  }
  .local-auth-help summary {
    cursor: pointer;
  }
  .local-auth-help ol {
    padding-left: 18px;
  }
  .local-auth-help code {
    overflow-wrap: anywhere;
  }
</style>
