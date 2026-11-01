<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    title,
    onBack,
    backLabel = 'Zurück zur Übersicht',
    maximized = true,
    children,
  }: {
    title: string;
    onBack: () => void;
    /** Names where the way back leads. */
    backLabel?: string;
    /**
     * A maximized section lands focus on its title; the repository picker is
     * no section and lands on the search field instead.
     */
    maximized?: boolean;
    /** Page actions at the right end of the header. */
    children?: Snippet;
  } = $props();
</script>

<!-- The header of a page stays above the scrolling body, so the way back is
     always in reach. The page body is labelled by its title. -->
<header class="page-header">
  <button
    class="icon-button page-back"
    aria-label={backLabel}
    aria-keyshortcuts="Escape"
    title={maximized ? 'Verkleinern · Esc' : 'Zurück · Esc'}
    onclick={() => onBack()}
    ><Icon name={maximized ? 'minimize' : 'back'} size={16} /></button
  >
  <h2
    id="page-title"
    class="page-title"
    tabindex="-1"
    data-focus-landing={maximized ? true : undefined}
  >
    {title}
  </h2>
  {#if children}<div class="page-actions">{@render children()}</div>{/if}
</header>
