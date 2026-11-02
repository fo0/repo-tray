<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import SectionHeader, {
    SECTION_ICONS,
    SECTION_UNITS,
  } from './SectionHeader.svelte';
  import type { SubPage } from './view.svelte';

  let {
    page,
    title,
    count,
    onBack,
    backLabel = 'Zurück zur Übersicht',
    maximized = true,
    children,
  }: {
    /** The shown page; a maximized section repeats its overview header. */
    page?: SubPage | undefined;
    title: string;
    /** The section's count, shown like on the overview. */
    count?: number | undefined;
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
{#if maximized && page && page !== 'picker'}
  <!-- The section's own header: the same title, count and actions, and the
       minimize button where the overview has the maximize button. -->
  <header class="page-header maximized">
    <SectionHeader
      {page}
      id="page-title"
      {title}
      {count}
      unit={SECTION_UNITS[page]}
      icon={SECTION_ICONS[page]}
      onMinimize={onBack}>{@render children?.()}</SectionHeader
    >
  </header>
{:else}
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
{/if}
