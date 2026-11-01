<script lang="ts">
  import RepoPick from './RepoPick.svelte';
  import { plural } from './format';
  import type { Panel } from './panel.svelte';
  import { permissionLabel } from './repoSelection.svelte';
  import type { Repo } from './types';

  let {
    panel,
    repos,
    accountName,
  }: {
    /** Toggles go through the panel's repository selection. */
    panel: Panel;
    /** Unselected repositories of the shown accounts matching the search. */
    repos: Repo[];
    accountName: (accountId: string) => string;
  } = $props();
</script>

<!-- A shortcut while searching: a match outside the tray is one click away;
     once added it moves to the list above with the next snapshot. -->
<section class="overview-section not-in-tray" aria-labelledby="not-in-tray">
  <div class="section-header">
    <h2 id="not-in-tray">Nicht im Tray</h2>
    <span class="section-count"
      ><span aria-hidden="true">{repos.length}</span><span class="sr-only"
        >{plural(repos.length, 'Repository', 'Repositories')}</span
      ></span
    >
  </div>
  <ul class="pick-list candidates">
    {#each repos as repo (repo.id)}<RepoPick
        {repo}
        meta={`${accountName(repo.accountId)} · ${permissionLabel(repo)}`}
        inTray={panel.selection.has(repo.id)}
        busy={panel.selection.busy(repo.id)}
        disabled={panel.settingsBusy && !panel.selectionBusy}
        onToggle={() => void panel.selection.toggle(repo.id)}
      />{/each}
  </ul>
</section>
