<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import { minuteClock } from './clock';
  import { runDuration } from './format';
  import { statusLabel } from './runs';
  import type { Run } from './types';

  let {
    runs,
    demo,
    repoName,
    onShow,
  }: {
    /** Open runs (running, queued, waiting), newest first. */
    runs: Run[];
    demo: boolean;
    /** Full repository name, e.g. `owner/name`. */
    repoName: (repoId: string) => string;
    /** Opens the run in the Verlauf with its details. */
    onShow: (runId: number) => void;
  } = $props();

  const icon = (run: Run): IconName =>
    run.status === 'waiting'
      ? 'pause'
      : run.status === 'queued'
        ? 'clock'
        : 'activity';
  const tone = (run: Run) =>
    run.status === 'waiting'
      ? 'wait'
      : run.status === 'queued'
        ? 'queue'
        : 'run';
</script>

<!-- Deliberately not a live region: the demo polls every second, and the
     rows only repeat what the Verlauf lists in full. -->
<ul class="live-runs">
  {#each runs as run (`${run.repoId}:${run.id}`)}
    {@const repo = repoName(run.repoId)}
    {@const elapsed = runDuration(run, $minuteClock, !demo)}
    <li>
      <!-- The key finds the rebuilt row when focus comes back from the Verlauf. -->
      <button
        class="live-run"
        data-focus-key={`run:${run.repoId}:${run.id}`}
        aria-label={`${run.name} #${run.id} · ${repo} · ${statusLabel(run)} · ${elapsed}`}
        title="Im Verlauf anzeigen"
        onclick={() => onShow(run.id)}
      >
        <span class={`live-icon ${tone(run)}`}
          ><Icon name={icon(run)} size={13} /></span
        >
        <span class="live-title"
          ><strong>{run.name}</strong><span class="live-repo"
            >· {repo.split('/').pop()}</span
          ></span
        >
        <span class="live-branch"
          ><Icon name="branch" size={11} /><span>{run.branch}</span></span
        >
        <span class="live-elapsed">{elapsed}</span>
      </button>
    </li>
  {/each}
</ul>
