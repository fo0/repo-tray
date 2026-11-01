<script lang="ts">
  import EmptyState, { type NextStep } from './EmptyState.svelte';
  import NotInTray from './NotInTray.svelte';
  import RepositoryList from './RepositoryList.svelte';
  import type { Modals } from './modals.svelte';
  import type { Panel } from './panel.svelte';
  import type { repositoryActivity } from './runs';
  import type { Repo } from './types';

  let {
    panel,
    modals,
    groups,
    candidates,
    accountName,
    setup,
    onClearQuery,
  }: {
    /** Starts, favorites and expanded rows come from the panel. */
    panel: Panel;
    /** Opens the start dialog for a workflow. */
    modals: Modals;
    /** Every selected repository matching the search, latest activity first. */
    groups: ReturnType<typeof repositoryActivity>;
    /** Search matches outside the tray: „Nicht im Tray“. */
    candidates: Repo[];
    accountName: (accountId: string) => string;
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
    native={panel.native}
    demo={panel.demo}
    busy={panel.selection.busy}
    onRemove={(id) => void panel.selection.remove(id)}
    onNotice={(text, tone) => panel.showNotice(text, tone)}
  />
{:else if !candidates.length}<EmptyState
    icon="search"
    iconSize={25}
    title="Keine passenden Repositories"
    text="Versuche einen anderen Suchbegriff."
    action={{ label: 'Suche leeren', icon: 'close', run: onClearQuery }}
  />{/if}
{#if !setup && candidates.length}<NotInTray
    {panel}
    repos={candidates}
    {accountName}
  />{/if}
