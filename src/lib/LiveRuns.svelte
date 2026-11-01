<script lang="ts">
  import Icon from './Icon.svelte';
  import { minuteClock } from './clock';
  import { runDuration } from './format';
  import { runLabel, runTone, shortRepo, statusLabel, TONE_ICON } from './runs';
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
</script>

<!-- Deliberately not a live region: the demo polls every second, and the
     rows only repeat what the Verlauf lists in full. -->
<ul class="live-runs">
  {#each runs as run (`${run.repoId}:${run.id}`)}
    {@const repo = repoName(run.repoId)}
    {@const elapsed = runDuration(run, $minuteClock, !demo)}
    {@const tone = runTone(run)}
    <li>
      <!-- The key finds the rebuilt row when focus comes back from the Verlauf. -->
      <button
        class="live-run"
        data-focus-key={`run:${run.repoId}:${run.id}`}
        aria-label={`${runLabel(run, repo)} · ${statusLabel(run)} · ${elapsed}`}
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
    </li>
  {/each}
</ul>
