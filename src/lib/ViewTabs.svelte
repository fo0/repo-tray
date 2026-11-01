<script module lang="ts">
  export type ViewTab = 'repositories' | 'activity' | 'launch';
</script>

<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    tab,
    activeRuns,
    onSelect,
  }: {
    tab: ViewTab;
    activeRuns: number;
    onSelect: (tab: ViewTab) => void;
  } = $props();
</script>

<nav class="tabs" aria-label="Ansicht">
  <button
    class:active={tab === 'repositories'}
    aria-current={tab === 'repositories' ? 'page' : undefined}
    aria-keyshortcuts="Control+1"
    title="Strg+1"
    onclick={() => onSelect('repositories')}
    ><Icon name="repo" size={16} />Repositories</button
  >
  <button
    class:active={tab === 'activity'}
    aria-current={tab === 'activity' ? 'page' : undefined}
    aria-keyshortcuts="Control+2"
    title="Strg+2"
    aria-label={activeRuns ? `Aktivität, ${activeRuns} aktiv` : undefined}
    onclick={() => onSelect('activity')}
    ><Icon name="activity" size={17} />Aktivität{#if activeRuns}<span
        class="tab-count">{activeRuns}</span
      >{/if}</button
  >
  <button
    class:active={tab === 'launch'}
    aria-current={tab === 'launch' ? 'page' : undefined}
    aria-keyshortcuts="Control+3"
    title="Strg+3"
    onclick={() => onSelect('launch')}
    ><Icon name="heart" size={16} />Favoriten</button
  >
</nav>
