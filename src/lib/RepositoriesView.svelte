<script lang="ts">
  import EmptyState from './EmptyState.svelte';
  import PinnedFavorites from './PinnedFavorites.svelte';
  import RepositoryList from './RepositoryList.svelte';
  import type { repositoryActivity } from './model';
  import type { DispatchTarget, Pin, Workflow } from './types';

  let {
    pins,
    groups,
    isUncertain,
    favorite,
    repoName,
    accountName,
    isStarting,
    busy,
    blocked,
    needsAccount,
    hasAccounts,
    accountNotice,
    searching,
    onConfigure,
    onRemove,
    onLaunch,
    onOpenWorkflow,
    onFavorite,
    onClearQuery,
    onOpenSettings,
  }: {
    pins: Pin[];
    groups: ReturnType<typeof repositoryActivity>;
    isUncertain: (pin: Pin) => boolean;
    favorite: (workflow: Workflow) => Pin | undefined;
    repoName: (repoId: string) => string;
    accountName: (accountId: string) => string;
    /** A start for this target is running; only that target is locked. */
    isStarting: (target: DispatchTarget) => boolean;
    /** A pin change is running. */
    busy: boolean;
    /** Why starts are off for every target (offline, forbidden); null otherwise. */
    blocked: string | null;
    needsAccount: boolean;
    hasAccounts: boolean;
    accountNotice: string;
    /** A search query is active. */
    searching: boolean;
    onConfigure: (pin: Pin) => void;
    onRemove: (pinId: string) => void;
    onLaunch: (pin: Pin) => void;
    onOpenWorkflow: (workflow: Workflow) => void;
    onFavorite: (workflow: Workflow) => void;
    onClearQuery: () => void;
    onOpenSettings: () => void;
  } = $props();
</script>

<PinnedFavorites
  {pins}
  {isUncertain}
  {repoName}
  {accountName}
  {isStarting}
  {busy}
  {blocked}
  {onConfigure}
  {onRemove}
  {onLaunch}
/>
<div class="section-heading repository-heading">
  <h2>Deine Repositories</h2>
  <span>Zuletzt aktiv zuerst</span>
</div>
<RepositoryList
  {groups}
  onopen={onOpenWorkflow}
  onfavorite={onFavorite}
  {favorite}
  {busy}
  {isStarting}
  {blocked}
/>
{#if !groups.length}<EmptyState
    icon="repo"
    iconSize={25}
    title={needsAccount
      ? hasAccounts
        ? 'Wähle ein aktives Konto'
        : 'Verbinde dein GitHub-Konto'
      : searching
        ? 'Keine passenden Repositories'
        : 'Noch keine Repositories ausgewählt'}
    text={needsAccount
      ? accountNotice ||
        (hasAccounts
          ? 'Wähle Konto und Repositories in den Einstellungen aus.'
          : 'Verbinde dein GitHub-Konto mit einem Token oder übernimm deine gh-Anmeldung.')
      : searching
        ? 'Versuche einen anderen Suchbegriff.'
        : 'Wähle Repositories in den Einstellungen aus.'}
    action={searching
      ? { label: 'Suche leeren', icon: 'close', run: onClearQuery }
      : needsAccount && !hasAccounts
        ? { label: 'GitHub-Konto verbinden', icon: 'plus', run: onOpenSettings }
        : {
            label: needsAccount
              ? 'Konto in Einstellungen wählen'
              : 'Repositories auswählen',
            icon: 'arrow',
            run: onOpenSettings,
          }}
  />{/if}
