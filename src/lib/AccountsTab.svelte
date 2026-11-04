<script lang="ts">
  import { tick } from 'svelte';
  import ConnectedAccounts from './ConnectedAccounts.svelte';
  import Icon from './Icon.svelte';
  import { m } from './i18n/index.svelte';
  import type { DemoScenario, Snapshot } from './types';

  const SCENARIOS: DemoScenario[] = [
    'normal',
    'offline',
    'forbidden',
    'uncertain',
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
    const next = SCENARIOS.find((item) => item === value);
    if (next) onScenario(next);
  }
</script>

{#if native && !accounts.length}
  <section class="account-empty" aria-labelledby="account-empty-heading">
    <span class="account-empty-icon"><Icon name="github" size={24} /></span>
    <h3 id="account-empty-heading">{m().accounts.tab.emptyHeading}</h3>
    <p>{m().accounts.tab.emptyHint}</p>
    <button
      class="primary-button"
      bind:this={connectButton}
      onclick={() => onConnect()}
      >{m().accounts.tab.connectGithub}<Icon name="plus" size={14} /></button
    >
  </section>
{:else if native}
  <section
    class="active-account-settings"
    aria-labelledby="active-account-heading"
  >
    <h3 id="active-account-heading">{m().accounts.tab.activeHeading}</h3>
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
      ><Icon name="plus" size={14} />{m().accounts.tab.add}</button
    >
  </section>
{/if}
{#if demo}
  <div class="settings-section">
    <h3>{m().accounts.tab.connection}</h3>
    <div class="connection-card">
      <Icon name="github" size={22} />
      <div>
        <strong>{m().accounts.tab.demoMode}</strong>
        <p>{m().accounts.tab.demoHint}</p>
      </div>
      <button class="text-button" onclick={() => onConnect()}
        >{m().accounts.tab.add}<Icon name="chevron" size={13} /></button
      >
    </div>
  </div>
  <div class="settings-section">
    <label class="field"
      ><span>{m().accounts.tab.scenario}</span><select
        aria-label={m().accounts.tab.scenario}
        value={scenario}
        onchange={(event) => chooseScenario(event.currentTarget.value)}
        >{#each SCENARIOS as item (item)}<option value={item}
            >{m().accounts.tab.scenarios[item]}</option
          >{/each}</select
      ></label
    >
    <button class="reset-button" onclick={() => onReset()} disabled={busy}
      ><Icon name="refresh" size={13} />{m().accounts.tab.reset}<span
        >{m().accounts.tab.resetHint}</span
      ></button
    >
  </div>
{/if}
