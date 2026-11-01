<script lang="ts">
  import { tick } from 'svelte';
  import ConnectedAccounts from './ConnectedAccounts.svelte';
  import Icon from './Icon.svelte';
  import { accountTitle } from './accountSelection';
  import { plural } from './format';
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
    accountNotice,
    scenario,
    busy,
    onChangeAccount,
    onConnect,
    onScenario,
    onReset,
    onDisconnect,
  }: {
    snapshot: Snapshot | null;
    native: boolean;
    demo: boolean;
    accountId: string;
    /** Why the active account had to be chosen again, if it had to. */
    accountNotice: string;
    scenario: DemoScenario;
    /** An account or demo mutation is running. */
    busy: boolean;
    onChangeAccount: (id: string) => void;
    onConnect: () => void;
    onScenario: (value: DemoScenario) => void;
    onReset: () => void;
    /** Resolves once the disconnect settled; errors are shown by the dialog. */
    onDisconnect: (id: string) => Promise<unknown>;
  } = $props();
  const accounts = $derived(snapshot?.accounts ?? []);
  let picker = $state<HTMLSelectElement>();
  let connectButton = $state<HTMLButtonElement>();

  /** After a removed card, focus goes to the next decision: pick or connect. */
  async function disconnect(id: string) {
    await onDisconnect(id);
    if (accounts.some((account) => account.id === id)) return;
    await tick();
    (accounts.length ? picker : connectButton)?.focus();
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
    <p>
      Verbinde dein GitHub-Konto mit einem Token oder übernimm deine Anmeldung
      aus der GitHub CLI. Zugangsdaten bleiben im Betriebssystem-Tresor.
    </p>
    <button
      class="primary-button"
      bind:this={connectButton}
      onclick={() => onConnect()}
      >GitHub-Konto verbinden<Icon name="plus" size={14} /></button
    >
  </section>
{:else}
  {#if native}
    <section
      class="active-account-settings"
      aria-labelledby="active-account-heading"
    >
      <h3 id="active-account-heading">Aktives Konto</h3>
      <p>
        Für Ansicht und neue Starts. Deine Kontoauswahl gilt sofort und wird
        gemerkt.
      </p>
      <label class="field">
        <span>Login und Anmeldequelle</span>
        <select
          bind:this={picker}
          aria-label="Aktives Konto auswählen"
          value={accountId}
          disabled={busy}
          onchange={(event) => onChangeAccount(event.currentTarget.value)}
        >
          <option value="" disabled>Aktives Konto auswählen</option>
          {#each accounts as account}<option value={account.id}
              >{accountTitle(account)}</option
            >{/each}
        </select>
      </label>
      {#if accountNotice}<p class="account-selection-notice" role="status">
          {accountNotice}
        </p>{/if}
      <ConnectedAccounts
        {accounts}
        activeAccountId={accountId}
        disabled={busy}
        onUse={onChangeAccount}
        onDisconnect={disconnect}
      />
    </section>
  {/if}
  <div class="settings-section">
    <h3>Verbindung</h3>
    <div class="connection-card">
      <Icon name="github" size={22} />
      <div>
        <strong
          >{demo
            ? 'Du bist im Demo-Modus'
            : `${plural(accounts.length, 'Konto', 'Konten')} verbunden`}</strong
        >
        <p>
          {demo
            ? 'Kein Konto verbunden. Starts sind nur simuliert.'
            : 'Tokens bleiben im Betriebssystem-Tresor.'}
        </p>
      </div>
      <button class="text-button" onclick={() => onConnect()}
        >Konto hinzufügen<Icon name="chevron" size={13} /></button
      >
    </div>
  </div>
  {#if demo}<div class="settings-section">
      <label class="field"
        ><span>Demo-Szenario</span><select
          aria-label="Demo-Szenario"
          value={scenario}
          onchange={(event) => chooseScenario(event.currentTarget.value)}
          >{#each scenarios as item}<option value={item.value}
              >{item.label}</option
            >{/each}</select
        ></label
      >
      <p class="field-help">
        Szenarien verwenden ausschließlich lokale Demo-Daten.
      </p>
      <button class="reset-button" onclick={() => onReset()} disabled={busy}
        ><Icon name="refresh" size={13} />Demo zurücksetzen<span
          >Setzt auch Favoriten und Auswahl zurück</span
        ></button
      >
    </div>
  {/if}
  {#if !demo}
    <p class="field-help account-semantics">
      Das aktive Konto steuert Ansicht und neue Starts. Andere Konten bleiben
      verbunden; ihre ausgewählten Repositories werden weiter beobachtet. Ein
      fehlgeschlagener Zugriff wechselt nicht automatisch das Konto.
    </p>
  {/if}
{/if}
