<script lang="ts">
  import ConnectedAccounts from './ConnectedAccounts.svelte';
  import Icon from './Icon.svelte';
  import { accountTitle } from './accountSelection';
  import { accountLabel } from './format';
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
    onDisconnect: (id: string) => void;
  } = $props();
  const accounts = $derived(snapshot?.accounts ?? []);

  function chooseScenario(value: string) {
    const next = scenarios.find((item) => item.value === value);
    if (next) onScenario(next.value);
  }
</script>

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
        aria-label="Aktives Konto auswählen"
        value={accountId}
        disabled={busy || !accounts.length}
        onchange={(event) => onChangeAccount(event.currentTarget.value)}
      >
        <option value="" disabled
          >{accounts.length
            ? 'Aktives Konto auswählen'
            : 'Noch kein Konto verbunden'}</option
        >
        {#each accounts as account}<option value={account.id}
            >{accountTitle(account)}</option
          >{/each}
      </select>
    </label>
    {#if accountNotice}<p class="account-selection-notice" role="status">
        {accountNotice}
      </p>{/if}
    {#if !accounts.length}<button
        class="secondary-button"
        onclick={() => onConnect()}
        >GitHub-Konto verbinden<Icon name="plus" size={14} /></button
      >{/if}
    <ConnectedAccounts
      {accounts}
      activeAccountId={accountId}
      disabled={busy}
      onUse={onChangeAccount}
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
          : `${accounts.length} Konten verbunden`}</strong
      >
      <p>
        {demo
          ? 'Kein Account verbunden. Keine echten Starts.'
          : 'Tokens bleiben im Betriebssystem-Tresor.'}
      </p>
    </div>
    <button class="text-button" onclick={() => onConnect()}
      >Einrichten<Icon name="chevron" size={13} /></button
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
        >Setzt auch Vorlagen & Auswahl zurück</span
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
  {#each accounts as account}<button
      class="text-button"
      disabled={busy}
      onclick={() => onDisconnect(account.id)}
      >{accountLabel(snapshot, account.id, native)} trennen</button
    >{/each}
{/if}
