<script module lang="ts">
  import type { ActivityFilter, RunTone } from './runs';

  const FILTERS: { id: ActivityFilter; label: string; tone?: RunTone }[] = [
    { id: 'all', label: 'Alle' },
    { id: 'active', label: 'Aktiv', tone: 'run' },
    { id: 'failed', label: 'Fehlgeschlagen', tone: 'fail' },
    { id: 'recent', label: 'Abgeschlossen' },
  ];
</script>

<script lang="ts">
  import EmptyState, { type NextStep } from './EmptyState.svelte';
  import Icon from './Icon.svelte';
  import RunRow from './RunRow.svelte';
  import { minuteClock } from './clock';
  import { focusLost, hasDom } from './focus';
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
  /** Aktiv and Fehlgeschlagen name their size; the other chips do not. */
  const count = (id: ActivityFilter) =>
    id === 'active' ? activeRuns : id === 'failed' ? failedRuns : undefined;
  /** Open runs under „Jetzt“, the completed history under „Abgeschlossen“. */
  const groups = $derived(
    [
      { id: 'now', title: 'Jetzt', runs: runs.filter(isActive) },
      {
        id: 'done',
        title: 'Abgeschlossen',
        runs: runs.filter((run) => !isActive(run)),
      },
    ].filter((group) => group.runs.length > 0),
  );

  /*
   * A run that moves between the groups, e.g. when it completes, is drawn
   * anew in the other one, and so is the hint when its group goes: focus
   * moves to the new run toggle or hint instead of dropping to the page.
   */
  let focusedKey: string | undefined;
  $effect.pre(() => {
    void groups;
    const active = hasDom() ? document.activeElement : null;
    focusedKey = active?.matches('.info-button')
      ? 'info'
      : active?.closest<HTMLElement>('.run')?.dataset.run;
  });
  $effect(() => {
    void groups;
    if (!focusedKey || !focusLost()) return;
    const target =
      focusedKey === 'info'
        ? document.querySelector<HTMLElement>('.info-button')
        : [...document.querySelectorAll<HTMLElement>('.run')]
            .find((node) => node.dataset.run === focusedKey)
            ?.querySelector<HTMLElement>('.run-button');
    target?.focus();
  });
</script>

<div class="filters" role="group" aria-label="Aktivitätsfilter">
  {#each FILTERS as item (item.id)}
    {@const runCount = count(item.id)}
    <button
      class:chosen={filter === item.id}
      aria-pressed={filter === item.id}
      aria-label={runCount === undefined
        ? undefined
        : `${item.label}, ${plural(runCount, 'Run', 'Runs')}`}
      onclick={() => onFilter(item.id)}
      >{#if item.tone}<span class="tone-dot" data-tone={item.tone}
        ></span>{/if}{item.label}{#if runCount !== undefined}<b>{runCount}</b
        >{/if}</button
    >
  {/each}
</div>
{#each groups as group, index (group.id)}
  <div class="section-header">
    <h3 id={`runs-${group.id}`}>{group.title}</h3>
    <span class="section-count"
      ><span aria-hidden="true">{group.runs.length}</span><span class="sr-only"
        >{plural(group.runs.length, 'Run', 'Runs')}</span
      ></span
    >
    {#if index === 0}<span class="section-actions"
        ><button
          class="icon-button info-button"
          aria-expanded={showNote}
          aria-controls="history-note"
          aria-label="Hinweis zum Verlauf"
          title="Hinweis zum Verlauf"
          onclick={() => (showNote = !showNote)}
          ><Icon name="info" size={15} /></button
        ></span
      >{/if}
  </div>
  {#if index === 0}<p class="history-note" id="history-note" hidden={!showNote}>
      <span class="tone-dot" data-tone="run"></span>Offene Runs werden
      automatisch aktualisiert.<br />Bis zu {HISTORY_LIMIT} abgeschlossene Runs bleiben
      im Verlauf.
    </p>{/if}
  <div class="run-list" role="group" aria-labelledby={`runs-${group.id}`}>
    {#each group.runs as run (`${run.repoId}:${run.id}`)}
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
    {/each}
  </div>
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
