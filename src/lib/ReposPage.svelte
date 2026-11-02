<script lang="ts">
  import EmptyState, { type NextStep } from './EmptyState.svelte';
  import Icon from './Icon.svelte';
  import RepositoryList from './RepositoryList.svelte';
  import { errorMessage } from './format';
  import type { Modals } from './modals.svelte';
  import type { Panel } from './panel.svelte';
  import type { repositoryActivity } from './runs';

  let {
    panel,
    modals,
    groups,
    searching,
    setup,
    onClearQuery,
  }: {
    /** Starts, favorites and expanded rows come from the panel. */
    panel: Panel;
    /** Opens the start dialog for a workflow. */
    modals: Modals;
    /** Every selected repository matching the search, latest activity first. */
    groups: ReturnType<typeof repositoryActivity>;
    /** A non-blank search query is active. */
    searching: boolean;
    /** The missing account step, shown instead of the list. */
    setup: NextStep | null;
    onClearQuery: () => void;
  } = $props();

  /** A GitHub App sign-in decides on GitHub which repositories it lists. */
  const browserInstallation = $derived(
    !panel.demo &&
      !!panel.snapshot?.accounts.some((account) =>
        account.id.startsWith('github-device-'),
      ),
  );
  /** Errors land in the banner; a stale refresh is announced there already. */
  async function attempt(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (cause) {
      panel.showNotice(errorMessage(cause), 'warning');
    }
  }
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
    onNotice={(text, tone) => panel.showNotice(text, tone)}
  />
{:else if searching}<EmptyState
    icon="search"
    iconSize={25}
    title="Keine passenden Repositories"
    text="Versuche einen anderen Suchbegriff."
    action={{ label: 'Suche leeren', icon: 'close', run: onClearQuery }}
  />{:else}<p class="section-empty">Keine Repositories gefunden.</p>{/if}
{#if !setup && browserInstallation}<div class="repository-access">
    <button
      class="text-button"
      disabled={panel.settingsBusy}
      onclick={() => void attempt(panel.manageInstallation)}
      >Repository-Freigabe auf GitHub ändern<Icon
        name="external"
        size={14}
      /></button
    ><button
      class="text-button"
      disabled={panel.settingsBusy}
      onclick={() => void attempt(panel.refreshAccess)}
      >Repository-Liste aktualisieren<Icon name="refresh" size={14} /></button
    >
  </div>{/if}
