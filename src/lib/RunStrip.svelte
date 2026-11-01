<script lang="ts">
  import { recentSummary, runTone } from './runs';
  import type { Run } from './types';

  let {
    cells,
  }: {
    /** `recentRuns`: oldest left, newest right, `null` where there is none. */
    cells: (Run | null)[];
  } = $props();

  const label = $derived(recentSummary(cells));
</script>

<!-- Colour alone says nothing: the label sums the cells up in words, and the
     repository row names its status as text. Neither focusable nor a
     live region; the demo changes runs every second. -->
<span class="run-strip" role="img" aria-label={label} title={label}>
  {#each cells as run, index (index)}<span
      class="strip-cell"
      data-tone={run ? runTone(run) : 'none'}
    ></span>{/each}
</span>
