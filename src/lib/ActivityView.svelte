<script module lang="ts">
  import type { ActivityFilter } from './runs';

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
  import EmptyState, { type NextStep } from './EmptyState.svelte';
  import Icon from './Icon.svelte';
  import RunRow from './RunRow.svelte';
  import { minuteClock } from './clock';
  import { plural } from './format';
  import { HISTORY_LIMIT, isActive } from './runs';
  import type { NoticeTone } from './StatusBanners.svelte';
  import type { Run } from './types';

  let {
    runs,
    filter,
    expanded,
    activeRuns,
    failedRuns,
    demo,
    native,
    setup,
    searching,
    repoName,
    repoAccountName,
    onFilter,
    onToggle,
    onClearQuery,
    onNotice,
  }: {
    runs: Run[];
    filter: ActivityFilter;
    /** ID of the run whose details are open. */
    expanded: number | null;
    activeRuns: number;
    failedRuns: number;
    demo: boolean;
    native: boolean;
    /** The missing account or repository step, named like on every page. */
    setup: NextStep | null;
    searching: boolean;
    repoName: (repoId: string) => string;
    repoAccountName: (repoId: string) => string;
    onFilter: (filter: ActivityFilter) => void;
    onToggle: (runId: number) => void;
    onClearQuery: () => void;
    onNotice: (text: string, tone: NoticeTone) => void;
  } = $props();

  /** The refresh and history-limit note is on demand, not always visible. */
  let showNote = $state(false);
  /** The divider goes above the first completed run after the open ones. */
  const followsOpenRun = (index: number) => {
    const previous = runs[index - 1];
    return !previous || isActive(previous);
  };
</script>

<div class="filters" role="group" aria-label="Aktivitätsfilter">
  {#each FILTERS as item (item.id)}<button
      class:chosen={filter === item.id}
      aria-pressed={filter === item.id}
      aria-label={item.id === 'active'
        ? `${item.label}, ${plural(activeRuns, 'Run', 'Runs')}`
        : item.id === 'failed'
          ? `${item.label}, ${plural(failedRuns, 'Run', 'Runs')}`
          : undefined}
      onclick={() => onFilter(item.id)}
      >{item.label}{#if item.id === 'active'}<span>{activeRuns}</span
        >{:else if item.id === 'failed'}<span>{failedRuns}</span>{/if}</button
    >{/each}
</div>
<div class="section-heading">
  <h3>{HEADINGS[filter]}</h3>
  <span class="history-count"
    >{plural(runs.length, 'Run', 'Runs')}<button
      class="info-button"
      aria-expanded={showNote}
      aria-controls="history-note"
      aria-label="Hinweis zum Verlauf"
      title="Hinweis zum Verlauf"
      onclick={() => (showNote = !showNote)}
      ><Icon name="info" size={15} /></button
    ></span
  >
</div>
<p class="history-note" id="history-note" hidden={!showNote}>
  <span class="group-live-dot"></span>Offene Runs werden automatisch
  aktualisiert.<br />Bis zu {HISTORY_LIMIT} abgeschlossene Runs bleiben im Verlauf.
</p>
<div class="run-list history-list">
  {#each runs as run, index (`${run.repoId}:${run.id}`)}
    {#if filter === 'all' && !isActive(run) && followsOpenRun(index)}<div
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
      now={$minuteClock}
      onToggle={() => onToggle(run.id)}
      {onNotice}
    />
  {:else}{#if setup}<EmptyState icon="activity" iconSize={25} {...setup} />
    {:else}<EmptyState
        icon="activity"
        iconSize={25}
        title={searching ? 'Keine passenden Runs' : 'Hier ist gerade Ruhe'}
        text={searching
          ? 'Versuche einen anderen Suchbegriff.'
          : 'Für diesen Filter gibt es keine Runs.'}
        action={searching
          ? { label: 'Suche leeren', icon: 'close', run: onClearQuery }
          : undefined}
      />{/if}{/each}
</div>
