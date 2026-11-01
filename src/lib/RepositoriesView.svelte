<script lang="ts">
  import EmptyState from './EmptyState.svelte';
  import PinnedFavorites from './PinnedFavorites.svelte';
  import RepositoryList from './RepositoryList.svelte';
  import type { Modals } from './modals.svelte';
  import type { repositoryActivity } from './runs';
  import type { Panel } from './panel.svelte';
  import type { Pin } from './types';

  let {
    panel,
    modals,
    pins,
    groups,
    repoName,
    accountName,
    searching,
    onClearQuery,
    onOpenSettings,
  }: {
    /** Starts, favorites and account state come from the panel. */
    panel: Panel;
    /** Opens the start dialog for a favorite or workflow. */
    modals: Modals;
    pins: Pin[];
    groups: ReturnType<typeof repositoryActivity>;
    repoName: (repoId: string) => string;
    accountName: (accountId: string) => string;
    /** A search query is active. */
    searching: boolean;
    onClearQuery: () => void;
    onOpenSettings: () => void;
  } = $props();
  const needsAccount = $derived(panel.needsAccount);
  const hasAccounts = $derived(!!panel.snapshot?.accounts.length);
</script>

<PinnedFavorites
  {pins}
  isUncertain={panel.starts.isQuarantined}
  {repoName}
  {accountName}
  gate={panel.starts.favoriteGate}
  onConfigure={(pin) => modals.openDispatch(pin)}
  onRemove={panel.favorites.remove}
  onLaunch={modals.launchPin}
/>
<div class="section-heading repository-heading">
  <h2>Deine Repositories</h2>
  <span>Zuletzt aktiv zuerst</span>
</div>
<RepositoryList
  {groups}
  onopen={(workflow) => modals.openDispatch(undefined, workflow)}
  onfavorite={(workflow) => void modals.toggleFavorite(workflow)}
  favorite={panel.favorites.find}
  gate={panel.starts.gate}
  uncertainRefs={panel.starts.uncertainRefs}
  expanded={panel.expandedRepos}
  onToggle={panel.toggleRepo}
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
      ? panel.accountNotice ||
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
