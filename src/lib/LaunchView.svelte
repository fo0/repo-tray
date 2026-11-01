<script lang="ts">
  import EmptyState from './EmptyState.svelte';
  import Icon from './Icon.svelte';
  import PinCard from './PinCard.svelte';
  import WorkflowList from './WorkflowList.svelte';
  import { plural } from './format';
  import type { DispatchTarget, Pin, Repo, Workflow } from './types';

  let {
    pins,
    launchRepos,
    workflowsFor,
    isUncertain,
    repoName,
    accountName,
    demo,
    isStarting,
    busy,
    blocked,
    searching,
    hasRepos,
    needsAccount,
    onLaunch,
    onConfigure,
    onRemove,
    onOpenWorkflow,
    onNew,
    onClearQuery,
    onOpenSettings,
  }: {
    pins: Pin[];
    /** Repositories with at least one workflow matching the search. */
    launchRepos: Repo[];
    workflowsFor: (repoId: string) => Workflow[];
    isUncertain: (pin: Pin) => boolean;
    repoName: (repoId: string) => string;
    accountName: (accountId: string) => string;
    demo: boolean;
    /** A start for this target is running; only that target is locked. */
    isStarting: (target: DispatchTarget) => boolean;
    busy: boolean;
    /** Why starts are off for every target (offline, forbidden); null otherwise. */
    blocked: string | null;
    /** A non-blank search query is active. */
    searching: boolean;
    hasRepos: boolean;
    needsAccount: boolean;
    onLaunch: (pin: Pin) => void;
    onConfigure: (pin: Pin) => void;
    onRemove: (pinId: string) => void;
    onOpenWorkflow: (workflow: Workflow) => void;
    onNew: () => void;
    onClearQuery: () => void;
    onOpenSettings: () => void;
  } = $props();
</script>

<div class="section-heading launch-heading">
  <h2><Icon name="heart" size={14} />Deine Favoriten</h2>
  <span>{plural(pins.length, 'Favorit', 'Favoriten')}</span>
</div>
<div class="pin-list" class:has-pins={pins.length > 0}>
  {#each pins as pin (pin.id)}
    <PinCard
      {pin}
      uncertain={isUncertain(pin)}
      repo={repoName(pin.repoId)}
      account={accountName(pin.accountId)}
      {demo}
      starting={isStarting(pin)}
      {busy}
      {blocked}
      onLaunch={() => onLaunch(pin)}
      onConfigure={() => onConfigure(pin)}
      onRemove={() => onRemove(pin.id)}
    />
  {:else}{#if !searching}<div class="empty-pins">
        <Icon name="pin" size={18} /><span
          >Deine häufigen Starts, einen Klick näher.<small
            >Klicke unter „Repositories“ beim Workflow auf das Herz, um ihn hier
            zu speichern.</small
          ></span
        >
      </div>{/if}{/each}
</div>
<div class="section-heading workflow-heading">
  <h2>Workflow auswählen</h2>
  <button class="text-button" onclick={() => onNew()} disabled={!hasRepos}
    >Starten…<Icon name="plus" size={13} /></button
  >
</div>
<WorkflowList repos={launchRepos} {workflowsFor} onOpen={onOpenWorkflow} />
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
      ? 'Wähle ein aktives Konto'
      : 'Wähle deine Repositories'}
    text={needsAccount
      ? 'Konto und Anmeldequelle findest du in den Einstellungen.'
      : 'Deine Auswahl erscheint hier.'}
    action={{
      label: 'Einstellungen öffnen',
      icon: 'arrow',
      run: onOpenSettings,
    }}
  />{/if}
