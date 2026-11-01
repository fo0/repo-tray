<script lang="ts">
  import EmptyState, { type NextStep } from './EmptyState.svelte';
  import RepositoryList from './RepositoryList.svelte';
  import type { Modals } from './modals.svelte';
  import type { Panel } from './panel.svelte';
  import type { repositoryActivity } from './runs';

  let {
    panel,
    modals,
    groups,
    setup,
    onClearQuery,
  }: {
    /** Starts, favorites and expanded rows come from the panel. */
    panel: Panel;
    /** Opens the start dialog for a workflow. */
    modals: Modals;
    /** Every selected repository matching the search, latest activity first. */
    groups: ReturnType<typeof repositoryActivity>;
    /** The missing account or repository step, shown instead of the list. */
    setup: NextStep | null;
    onClearQuery: () => void;
  } = $props();
</script>

{#if setup}<EmptyState icon="repo" iconSize={25} {...setup} />
{:else if groups.length}<RepositoryList
    {groups}
    onopen={(workflow) => modals.openDispatch(undefined, workflow)}
    onfavorite={(workflow) => void modals.toggleFavorite(workflow)}
    favorite={panel.favorites.find}
    gate={panel.starts.gate}
    uncertainRefs={panel.starts.uncertainRefs}
    expanded={panel.expandedRepos}
    onToggle={panel.toggleRepo}
  />
{:else}<EmptyState
    icon="search"
    iconSize={25}
    title="Keine passenden Repositories"
    text="Versuche einen anderen Suchbegriff."
    action={{ label: 'Suche leeren', icon: 'close', run: onClearQuery }}
  />{/if}
