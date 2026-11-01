<script lang="ts">
  import EmptyState, { type NextStep } from './EmptyState.svelte';
  import Icon from './Icon.svelte';
  import PinCard from './PinCard.svelte';
  import type { Modals } from './modals.svelte';
  import type { Panel } from './panel.svelte';
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
</script>

{#if setup}<EmptyState icon="heart" iconSize={25} {...setup} />
{:else if pins.length}<div class="pin-list has-pins">
    {#each pins as pin (pin.id)}
      <PinCard
        {pin}
        uncertain={panel.starts.isQuarantined(pin)}
        repo={repoName(pin.repoId)}
        account={accountName(pin.accountId)}
        demo={panel.demo}
        gate={panel.starts.favoriteGate(pin)}
        onLaunch={() => modals.launchPin(pin)}
        onConfigure={() => modals.openDispatch(pin)}
        onRemove={() => panel.favorites.remove(pin.id)}
      />
    {/each}
  </div>
{:else if searching}<EmptyState
    icon="search"
    iconSize={25}
    title="Keine passenden Favoriten"
    text="Versuche einen anderen Suchbegriff."
    action={{ label: 'Suche leeren', icon: 'close', run: onClearQuery }}
  />
{:else}<div class="empty-pins">
    <Icon name="heart" size={18} /><span
      >Deine häufigen Starts, einen Klick näher.<small
        >Klicke in der Übersicht beim Workflow eines Repositorys auf das Herz,
        um ihn hier zu speichern.</small
      ></span
    >
  </div>{/if}
