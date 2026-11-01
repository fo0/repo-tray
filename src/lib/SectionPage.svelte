<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    title,
    onBack,
    children,
  }: {
    title: string;
    onBack: () => void;
    /** Page actions at the right end of the header. */
    children?: Snippet;
  } = $props();
</script>

<!-- The header of a maximized section stays above the scrolling body, so the
     way back is always in reach. The page body is labelled by its title, and
     the title is where focus lands when the page opens. -->
<header class="page-header">
  <button
    class="icon-button page-back"
    aria-label="Zurück zur Übersicht"
    aria-keyshortcuts="Escape"
    title="Verkleinern · Esc"
    onclick={() => onBack()}><Icon name="minimize" size={16} /></button
  >
  <h2 id="page-title" class="page-title" tabindex="-1" data-focus-landing>
    {title}
  </h2>
  {#if children}<div class="page-actions">{@render children()}</div>{/if}
</header>
