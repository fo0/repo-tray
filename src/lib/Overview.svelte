<script module lang="ts">
  import type { SectionPage } from './view.svelte';

  /** Rows per section before „+N weitere“ leads to the maximized page. */
  export const CAPS: Record<SectionPage, number> = {
    runs: 3,
    favorites: 4,
    repos: 6,
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import EmptyState, { type NextStep } from './EmptyState.svelte';
  import FavoriteTiles from './FavoriteTiles.svelte';
  import Icon from './Icon.svelte';
  import LiveRuns from './LiveRuns.svelte';
  import NotInTray from './NotInTray.svelte';
  import RepositoryList from './RepositoryList.svelte';
  import SectionHeader from './SectionHeader.svelte';
  import type { Modals } from './modals.svelte';
  import type { Panel } from './panel.svelte';
  import type { repositoryActivity } from './runs';
  import type { Pin, Repo, Run } from './types';
  import type { PanelView } from './view.svelte';

  let {
    panel,
    modals,
    view,
    live,
    pins,
    groups,
    repoName,
    accountName,
    searching,
    setup,
    candidates,
    onClearQuery,
    add,
  }: {
    /** Starts, favorites and account state come from the panel. */
    panel: Panel;
    modals: Modals;
    view: PanelView;
    /** Open runs matching the search. */
    live: Run[];
    /** Favorites matching the search. */
    pins: Pin[];
    groups: ReturnType<typeof repositoryActivity>;
    repoName: (repoId: string) => string;
    accountName: (accountId: string) => string;
    /** A non-blank search query is active; it lifts the caps. */
    searching: boolean;
    /** The missing account or repository step, shown instead of the sections. */
    setup: NextStep | null;
    /** Search matches outside the tray: „Nicht im Tray“. */
    candidates: Repo[];
    onClearQuery: () => void;
    /** The „Hinzufügen“ button of the Repositories header. */
    add: Snippet;
  } = $props();

  const capped = <T,>(items: T[], page: SectionPage) =>
    searching ? items : items.slice(0, CAPS[page]);
  const shownLive = $derived(capped(live, 'runs'));
  const shownPins = $derived(capped(pins, 'favorites'));
  const shownGroups = $derived(capped(groups, 'repos'));
</script>

{#snippet more(page: SectionPage, hidden: number, noun: string)}
  {#if hidden > 0}<button
      class="text-button more-button"
      data-focus-key={`more:${page}`}
      aria-label={`+${hidden} weitere ${noun} anzeigen`}
      onclick={() => void view.showMore(page)}
      >+{hidden} weitere<Icon name="maximize" size={12} /></button
    >{/if}
{/snippet}

{#snippet notInTray()}{#if candidates.length}<NotInTray
      {panel}
      repos={candidates}
      {accountName}
    />{/if}{/snippet}

{#if setup}<EmptyState icon="tray" iconSize={25} {...setup} />
{:else if searching && !live.length && !pins.length && !groups.length}
  <!-- Nothing in the tray matches: only the matches outside it, if any. -->
  {#if candidates.length}{@render notInTray()}{:else}<EmptyState
      icon="search"
      iconSize={25}
      title="Keine Treffer"
      text="Keine laufenden Runs, Favoriten oder Repositories passen. Versuche einen anderen Suchbegriff."
      action={{ label: 'Suche leeren', icon: 'close', run: onClearQuery }}
    />{/if}
{:else}
  <section class="overview-section" aria-labelledby="section-runs">
    <SectionHeader
      page="runs"
      id="section-runs"
      title="Läuft gerade"
      count={live.length}
      unit={['Run', 'Runs']}
      live={live.length > 0}
      onMaximize={() => void view.open('runs')}
    />
    {#if live.length}<LiveRuns
        runs={shownLive}
        demo={panel.demo}
        {repoName}
        onShow={(id) => void view.showRun(id)}
      />{:else}<p class="section-empty">
        {searching ? 'Keine passenden laufenden Runs.' : 'Gerade läuft nichts.'}
      </p>{/if}
    {@render more('runs', live.length - shownLive.length, 'Runs')}
  </section>

  <section class="overview-section" aria-labelledby="section-favorites">
    <SectionHeader
      page="favorites"
      id="section-favorites"
      title="Favoriten"
      count={pins.length}
      unit={['Favorit', 'Favoriten']}
      icon="heart"
      onMaximize={() => void view.open('favorites')}
    />
    {#if pins.length}<FavoriteTiles
        pins={shownPins}
        isUncertain={panel.starts.isQuarantined}
        {repoName}
        {accountName}
        gate={panel.starts.favoriteGate}
        onConfigure={(pin) => modals.openDispatch(pin)}
        onRemove={panel.favorites.remove}
        onLaunch={modals.launchPin}
      />{:else}<p class="section-empty">
        {searching
          ? 'Keine passenden Favoriten.'
          : 'Noch keine Favoriten. Speichere Workflows mit dem Herz.'}
      </p>{/if}
    {@render more('favorites', pins.length - shownPins.length, 'Favoriten')}
  </section>

  <section class="overview-section" aria-labelledby="section-repos">
    <SectionHeader
      page="repos"
      id="section-repos"
      title="Repositories"
      count={groups.length}
      unit={['Repository', 'Repositories']}
      onMaximize={() => void view.open('repos')}>{@render add()}</SectionHeader
    >
    {#if groups.length}<RepositoryList
        groups={shownGroups}
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
      />{:else}<p class="section-empty">Keine passenden Repositories.</p>{/if}
    {@render more('repos', groups.length - shownGroups.length, 'Repositories')}
  </section>
  {@render notInTray()}
{/if}
