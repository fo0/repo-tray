<script lang="ts">
  import EmptyState, { type NextStep } from './EmptyState.svelte';
  import FavoriteTiles from './FavoriteTiles.svelte';
  import Icon from './Icon.svelte';
  import { m } from './i18n/index.svelte';
  import type { Modals } from './modals.svelte';
  import type { Panel } from './panel.svelte';
  import { lastRun } from './repoActivity';
  import type { Pin } from './types';

  let {
    panel,
    modals,
    pins,
    repoName,
    accountName,
    searching,
    setup,
    onClearQuery,
  }: {
    /** Starts, favorites and account state come from the panel. */
    panel: Panel;
    /** Opens the start dialog for a favorite. */
    modals: Modals;
    /** Favorites matching the search. */
    pins: Pin[];
    repoName: (repoId: string) => string;
    accountName: (accountId: string) => string;
    /** A non-blank search query is active. */
    searching: boolean;
    /** The missing account or repository step, shown instead of the list. */
    setup: NextStep | null;
    onClearQuery: () => void;
  } = $props();

  const pinRun = (pin: Pin) =>
    panel.snapshot ? lastRun(panel.snapshot, pin.repoId, pin.workflowId) : null;
</script>

{#if setup}<EmptyState icon="heart" iconSize={25} {...setup} />
{:else if pins.length}<FavoriteTiles
    {pins}
    isUncertain={panel.starts.isQuarantined}
    {repoName}
    {accountName}
    gate={panel.starts.favoriteGate}
    onConfigure={(pin) => modals.openDispatch(pin)}
    onEdit={modals.editPin}
    onRemove={panel.favorites.remove}
    onLaunch={modals.launchPin}
    lastRun={pinRun}
    help
    demo={panel.demo}
  />
{:else if searching}<EmptyState
    icon="search"
    iconSize={25}
    title={m().favorites.page.noMatch}
    text={m().favorites.page.noMatchHint}
    action={{
      label: m().favorites.page.clearSearch,
      icon: 'close',
      run: onClearQuery,
    }}
  />
{:else}<div class="empty-pins">
    <Icon name="heart" size={18} /><span
      >{m().favorites.page.empty}<small>{m().favorites.page.emptyHint}</small
      ></span
    >
  </div>{/if}
