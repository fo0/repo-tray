<script lang="ts">
  import { tick } from 'svelte';
  import ConnectedAccounts from './ConnectedAccounts.svelte';
  import Icon from './Icon.svelte';
  import type { DemoScenario, Snapshot } from './types';

  const scenarios: { value: DemoScenario; label: string }[] = [
    { value: 'normal', label: 'Normal · lokale Simulation' },
    { value: 'offline', label: 'Offline · letzter Stand' },
    { value: 'forbidden', label: 'Keine Berechtigung · 403' },
    { value: 'uncertain', label: 'Unklare Antwort · Start gesperrt' },
  ];

  let {
    snapshot,
    native,
    demo,
    accountId,
    choice,
    accountNotice,
    scenario,
    busy,
    onChoose,
    onConnect,
    onScenario,
    onReset,
    onDisconnect,
  }: {
    snapshot: Snapshot | null;
    native: boolean;
    demo: boolean;
    /** The account in effect. */
    accountId: string;
    /** The staged account choice; „Speichern“ applies it. */
    choice: string;
    /** Why the active account had to be chosen again, if it had to. */
    accountNotice: string;
    /** The staged demo scenario. */
    scenario: DemoScenario;
    /** An account or demo mutation is running. */
    busy: boolean;
    onChoose: (id: string) => void;
    onConnect: () => void;
    onScenario: (value: DemoScenario) => void;
    onReset: () => void;
    /** Resolves once the disconnect settled; errors are shown by the dialog. */
    onDisconnect: (id: string) => Promise<unknown>;
  } = $props();
  const accounts = $derived(snapshot?.accounts ?? []);
  let list = $state<ReturnType<typeof ConnectedAccounts>>();
  let connectButton = $state<HTMLButtonElement>();

  /** After a removed card, focus goes to the next decision: pick or connect. */
  async function disconnect(id: string) {
    await onDisconnect(id);
    if (accounts.some((account) => account.id === id)) return;
    await tick();
    if (accounts.length) list?.focusChoice();
    else connectButton?.focus();
  }

  function chooseScenario(value: string) {
    const next = scenarios.find((item) => item.value === value);
    if (next) onScenario(next.value);
  }
</script>

{#if native && !accounts.length}
  <section class="account-empty" aria-labelledby="account-empty-heading">
    <span class="account-empty-icon"><Icon name="github" size={24} /></span>
    <h3 id="account-empty-heading">Noch kein Konto verbunden</h3>
    <p>Zugangsdaten bleiben im Windows-Tresor.</p>
    <button
      class="primary-button"
      bind:this={connectButton}
      onclick={() => onConnect()}
      >GitHub-Konto verbinden<Icon name="plus" size={14} /></button
    >
  </section>
{:else if native}
  <section
    class="active-account-settings"
    aria-labelledby="active-account-heading"
  >
    <h3 id="active-account-heading">Aktives Konto</h3>
    {#if accountNotice}<p class="account-selection-notice" role="status">
        {accountNotice}
      </p>{/if}
    <ConnectedAccounts
      bind:this={list}
      {accounts}
      activeAccountId={accountId}
      {choice}
      uncertainStarts={snapshot?.uncertainStarts}
      disabled={busy}
      {onChoose}
      onDisconnect={disconnect}
    />
    <button class="secondary-button add-account" onclick={() => onConnect()}
      ><Icon name="plus" size={14} />Konto hinzufügen</button
    >
  </section>
{/if}
{#if demo}
  <div class="settings-section">
    <h3>Verbindung</h3>
    <div class="connection-card">
      <Icon name="github" size={22} />
      <div>
        <strong>Demo-Modus</strong>
        <p>Starts sind nur simuliert.</p>
      </div>
      <button class="text-button" onclick={() => onConnect()}
        >Konto hinzufügen<Icon name="chevron" size={13} /></button
      >
    </div>
  </div>
  <div class="settings-section">
    <label class="field"
      ><span>Demo-Szenario</span><select
        aria-label="Demo-Szenario"
        value={scenario}
        onchange={(event) => chooseScenario(event.currentTarget.value)}
        >{#each scenarios as item (item.value)}<option value={item.value}
            >{item.label}</option
          >{/each}</select
      ></label
    >
    <button class="reset-button" onclick={() => onReset()} disabled={busy}
      ><Icon name="refresh" size={13} />Demo zurücksetzen<span
        >Setzt auch Favoriten zurück</span
      ></button
    >
  </div>
{/if}
