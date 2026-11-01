<script lang="ts">
  import { onDestroy } from 'svelte';
  import LocalAccountImport from './LocalAccountImport.svelte';
  import LocalAuthHelp from './LocalAuthHelp.svelte';
  import LocalAuthToggle from './LocalAuthToggle.svelte';
  import { ipcErrorMessage } from './format';
  import { call } from './ipc';
  import type {
    Account as ConnectedAccount,
    LocalAccount,
    Snapshot,
  } from './types';
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
  let accounts = $state<LocalAccount[]>([]);
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
      const result = await call('discover_local_auth');
      if (!active || ticket !== generation) return;
      accounts = result.accounts;
      notices = result.notices;
      checked = true;
      const usable = accounts.filter((a) => a.usable && a.source === 'gh');
      if (usable.length === 1 && usable[0]) selected = usable[0].login;
    } catch (cause) {
      if (active && ticket === generation)
        error = ipcErrorMessage(
          cause,
          'Lokale Anmeldung konnte nicht geprüft werden. Versuche es erneut.',
        );
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
      const snapshot = await call('connect_local_auth', {
        login: chosen.login,
        confirmImport: true,
      });
      if (active && ticket === generation) onConnected(snapshot);
    } catch (cause) {
      if (active && ticket === generation)
        error = ipcErrorMessage(
          cause,
          'Lokale Anmeldung wurde nicht übernommen. Prüfe Konto, Netzwerk und Betriebssystem-Tresor und suche erneut.',
        );
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
    void call('cancel_connect').catch(() => {});
  }
  onDestroy(() => {
    active = false;
    generation++;
    onBusy(false);
    if (busy) void call('cancel_connect').catch(() => {});
  });
</script>

<div class="token-path local-auth">
  <LocalAuthToggle
    {expanded}
    {disabled}
    connected={connectedGh.length}
    onToggle={() => {
      expanded = !expanded;
      if (!expanded && busy) cancel();
    }}
  />
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
          <LocalAccountImport
            account={chosen}
            imported={chosenImported}
            {activeAccountId}
            {busy}
            {disabled}
            {importing}
            bind:consent
            onConnect={connect}
            {onUseAccount}
          />
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
    <LocalAuthHelp />
  </div>
</div>

<style>
  .local-auth {
    text-align: left;
  }
  /* Also spaces the paragraphs of the child components. */
  .local-auth :global(p) {
    margin: 0.65rem 0;
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
</style>
