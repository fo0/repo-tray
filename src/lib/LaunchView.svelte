<script lang="ts">
  import EmptyState from './EmptyState.svelte';
  import Icon from './Icon.svelte';
  import PinCard from './PinCard.svelte';
  import WorkflowList from './WorkflowList.svelte';
  import { plural } from './format';
  import type { Modals } from './modals.svelte';
  import type { Panel } from './panel.svelte';
  import { blockedReason } from './startReason';
  import type { Pin, Repo, Workflow } from './types';

  let {
    panel,
    modals,
    pins,
    launchRepos,
    workflowsFor,
    repoName,
    accountName,
    searching,
    hasRepos,
    onClearQuery,
    onOpenSettings,
  }: {
    /** Starts, favorites and account state come from the panel. */
    panel: Panel;
    /** Opens the start dialog for a favorite or workflow. */
    modals: Modals;
    pins: Pin[];
    /** Repositories with at least one workflow matching the search. */
    launchRepos: Repo[];
    workflowsFor: (repoId: string) => Workflow[];
    repoName: (repoId: string) => string;
    accountName: (accountId: string) => string;
    /** A non-blank search query is active. */
    searching: boolean;
    hasRepos: boolean;
    onClearQuery: () => void;
    /** Opens the missing step: connect, account or repositories. */
    onOpenSettings: () => void;
  } = $props();
  const blocked = $derived(blockedReason(panel.snapshot));
  const needsAccount = $derived(panel.needsAccount);
  const hasAccounts = $derived(!!panel.snapshot?.accounts.length);
</script>

<div class="section-heading launch-heading">
  <h2><Icon name="heart" size={14} />Deine Favoriten</h2>
  <span>{plural(pins.length, 'Favorit', 'Favoriten')}</span>
</div>
<div class="pin-list" class:has-pins={pins.length > 0}>
  {#each pins as pin (pin.id)}
    <PinCard
      {pin}
      uncertain={panel.starts.isQuarantined(pin)}
      repo={repoName(pin.repoId)}
      account={accountName(pin.accountId)}
      demo={panel.demo}
      starting={panel.starts.isRunning(pin)}
      busy={panel.pinsBusy}
      {blocked}
      onLaunch={() => modals.launchPin(pin)}
      onConfigure={() => modals.openDispatch(pin)}
      onRemove={() => panel.favorites.remove(pin.id)}
    />
  {:else}{#if !searching}<div class="empty-pins">
        <Icon name="heart" size={18} /><span
          >Deine häufigen Starts, einen Klick näher.<small
            >Klicke unter „Repositories“ beim Workflow auf das Herz, um ihn hier
            zu speichern.</small
          ></span
        >
      </div>{/if}{/each}
</div>
<div class="section-heading workflow-heading">
  <h2>Workflow auswählen</h2>
  <button
    class="text-button"
    onclick={() => modals.openDispatch()}
    disabled={!hasRepos}>Starten…<Icon name="plus" size={13} /></button
  >
</div>
<WorkflowList
  repos={launchRepos}
  {workflowsFor}
  uncertainRefs={panel.starts.uncertainRefs}
  onOpen={(workflow) => modals.openDispatch(undefined, workflow)}
/>
{#if searching && !pins.length && !launchRepos.length}<EmptyState
    icon="search"
    iconSize={26}
    framed={false}
    title="Keine passenden Favoriten oder Workflows"
    text="Versuche einen anderen Suchbegriff."
    action={{ label: 'Suche leeren', icon: 'close', run: onClearQuery }}
  />{/if}
{#if !hasRepos}<EmptyState
    icon="repo"
    iconSize={26}
    framed={false}
    title={needsAccount
      ? hasAccounts
        ? 'Wähle ein aktives Konto'
        : 'Verbinde dein GitHub-Konto'
      : 'Wähle deine Repositories'}
    text={needsAccount
      ? panel.accountNotice ||
        (hasAccounts
          ? 'Konto und Anmeldequelle findest du in den Einstellungen.'
          : 'Verbinde dein GitHub-Konto mit einem Token oder übernimm deine gh-Anmeldung.')
      : 'Deine Auswahl erscheint hier.'}
    action={needsAccount && !hasAccounts
      ? { label: 'GitHub-Konto verbinden', icon: 'plus', run: onOpenSettings }
      : { label: 'Einstellungen öffnen', icon: 'arrow', run: onOpenSettings }}
  />{/if}
