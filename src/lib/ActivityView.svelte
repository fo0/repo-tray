<script module lang="ts">
  import type { ActivityFilter } from './model';

  const FILTERS: { id: ActivityFilter; label: string }[] = [
    { id: 'all', label: 'Alle' },
    { id: 'active', label: 'Aktiv' },
    { id: 'failed', label: 'Fehlgeschlagen' },
    { id: 'recent', label: 'Abgeschlossen' },
  ];
  const HEADINGS: Record<ActivityFilter, string> = {
    all: 'Letzte Aktivitäten',
    active: 'Aktive Runs',
    failed: 'Fehlgeschlagene Runs',
    recent: 'Abgeschlossene Runs',
  };
</script>

<script lang="ts">
  import EmptyState from './EmptyState.svelte';
  import RunRow from './RunRow.svelte';
  import { HISTORY_LIMIT, isActive } from './model';
  import type { Run } from './types';

  let {
    runs,
    filter,
    expanded,
    activeRuns,
    failedRuns,
    demo,
    native,
    needsAccount,
    hasAccounts,
    hasRepos,
    searching,
    accountNotice,
    repoName,
    repoAccountName,
    onFilter,
    onToggle,
    onOpenSettings,
    onLinkError,
  }: {
    runs: Run[];
    filter: ActivityFilter;
    /** ID of the run whose details are open. */
    expanded: number | null;
    activeRuns: number;
    failedRuns: number;
    demo: boolean;
    native: boolean;
    needsAccount: boolean;
    hasAccounts: boolean;
    hasRepos: boolean;
    searching: boolean;
    accountNotice: string;
    repoName: (repoId: string) => string;
    repoAccountName: (repoId: string) => string;
    onFilter: (filter: ActivityFilter) => void;
    onToggle: (runId: number) => void;
    onOpenSettings: () => void;
    onLinkError: (message: string) => void;
  } = $props();
</script>

<div class="filters" role="group" aria-label="Aktivitätsfilter">
  {#each FILTERS as item (item.id)}<button
      class:chosen={filter === item.id}
      aria-pressed={filter === item.id}
      onclick={() => onFilter(item.id)}
      >{item.label}{#if item.id === 'active'}<span>{activeRuns}</span
        >{:else if item.id === 'failed'}<span>{failedRuns}</span>{/if}</button
    >{/each}
</div>
<div class="section-heading">
  <h2>{HEADINGS[filter]}</h2>
  <span>{runs.length} {runs.length === 1 ? 'Run' : 'Runs'}</span>
</div>
<p class="history-note">
  <span class="group-live-dot"></span>Offene Runs werden automatisch
  aktualisiert.<br />Bis zu {HISTORY_LIMIT} abgeschlossene Runs bleiben im Verlauf.
</p>
<div class="run-list history-list">
  {#each runs as run, index (`${run.repoId}:${run.id}`)}
    {#if filter === 'all' && !isActive(run) && (index === 0 || isActive(runs[index - 1]))}<div
        class="list-divider"
      >
        <span>Zuletzt abgeschlossen</span>
      </div>{/if}
    <RunRow
      {run}
      expanded={expanded === run.id}
      repo={repoName(run.repoId)}
      account={repoAccountName(run.repoId)}
      {demo}
      {native}
      onToggle={() => onToggle(run.id)}
      {onLinkError}
    />
  {:else}<EmptyState
      icon="activity"
      iconSize={25}
      title={needsAccount
        ? hasAccounts
          ? 'Wähle ein aktives Konto'
          : 'Verbinde dein GitHub-Konto'
        : hasRepos
          ? 'Hier ist gerade Ruhe'
          : 'Noch keine Repositories ausgewählt'}
      text={needsAccount
        ? accountNotice ||
          'Öffne die Einstellungen und wähle dort Konto und Anmeldequelle. Repository-Starts bleiben an ihr Konto gebunden.'
        : searching
          ? 'Für diese Suche gibt es keine Runs.'
          : hasRepos
            ? 'Für diesen Filter gibt es keine Runs.'
            : 'Wähle Repositories in den Einstellungen aus.'}
      action={needsAccount
        ? {
            label: 'Konto in Einstellungen wählen',
            icon: 'arrow',
            run: onOpenSettings,
          }
        : !hasRepos
          ? {
              label: 'Repositories auswählen',
              icon: 'arrow',
              run: onOpenSettings,
            }
          : undefined}
    />{/each}
</div>
