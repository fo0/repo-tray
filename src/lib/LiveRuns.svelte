<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { ArmedConfirm } from './armedConfirm.svelte';
  import { minuteClock } from './clock';
  import { runDuration } from './format';
  import { runLabel, runTone, shortRepo, statusLabel, TONE_ICON } from './runs';
  import type { Run } from './types';

  let {
    runs,
    demo,
    repoName,
    canCancel = () => false,
    isCancelling = () => false,
    onCancel,
    onShow,
  }: {
    /** Open runs (running, queued, waiting), newest first. */
    runs: Run[];
    demo: boolean;
    /** Full repository name, e.g. `owner/name`. */
    repoName: (repoId: string) => string;
    /** The run is open and its repository grants write access. */
    canCancel?: (run: Run) => boolean;
    /** A cancel request for the run is pending or accepted. */
    isCancelling?: (run: Run) => boolean;
    onCancel?: (run: Run) => void;
    /** Opens the run in the Verlauf with its details. */
    onShow: (runId: number) => void;
  } = $props();

  /** The stop button asks „Abbrechen?“ first; a second click cancels. */
  const confirm = new ArmedConfirm<number>();
  function press(run: Run) {
    if (!isCancelling(run)) confirm.press(run.id, () => onCancel?.(run));
  }
  onDestroy(confirm.disarm);
</script>

<!-- Deliberately not a live region: the demo polls every second, and the
     rows only repeat what the Verlauf lists in full. -->
<ul class="live-runs">
  {#each runs as run (`${run.repoId}:${run.id}`)}
    {@const repo = repoName(run.repoId)}
    {@const elapsed = runDuration(run, $minuteClock, !demo)}
    {@const tone = runTone(run)}
    {@const stopping = isCancelling(run)}
    <li class="live-row">
      <!-- The key finds the rebuilt row when focus comes back from the Verlauf. -->
      <button
        class="live-run"
        data-focus-key={`run:${run.repoId}:${run.id}`}
        aria-label={`${runLabel(run, repo)} · ${stopping ? 'Wird abgebrochen' : statusLabel(run)} · ${elapsed}`}
        title="Im Verlauf anzeigen"
        onclick={() => onShow(run.id)}
      >
        <span class="status-tile" data-tone={tone}
          ><Icon name={TONE_ICON[tone]} size={13} /></span
        >
        <!-- The repository leads: every repository may name its workflow
             „Release“. The owner is in its tooltip and the accessible name. -->
        <span class="live-title"
          ><strong title={repo}>{shortRepo(repo)}</strong><span
            class="live-workflow"
            >· {run.name}<span class="live-number">#{run.id}</span></span
          ></span
        >
        <span class="branch-chip"
          ><Icon name="branch" size={11} /><span>{run.branch}</span></span
        >
        <span class="live-elapsed">{elapsed}</span>
      </button>
      {#if canCancel(run)}<button
          class="live-cancel"
          class:armed={confirm.is(run.id)}
          data-cancel-run={run.id}
          aria-label={stopping
            ? `${runLabel(run, repo)} wird abgebrochen`
            : confirm.is(run.id)
              ? `${runLabel(run, repo)} wirklich abbrechen?`
              : `${runLabel(run, repo)} abbrechen`}
          aria-disabled={stopping ? 'true' : undefined}
          title={stopping
            ? 'Wird abgebrochen …'
            : confirm.is(run.id)
              ? 'Zum Abbrechen erneut klicken'
              : 'Run abbrechen'}
          onclick={() => press(run)}
          onblur={() => confirm.is(run.id) && confirm.disarm()}
          >{#if stopping}<Icon
              name="spinner"
              size={13}
              class="cancel-spinner"
            />{:else if confirm.is(run.id)}Abbrechen?{:else}<Icon
              name="stop"
              size={15}
            />{/if}</button
        >{/if}
    </li>
  {/each}
</ul>
