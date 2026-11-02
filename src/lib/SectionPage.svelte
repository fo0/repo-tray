<script lang="ts">
  import type { Snippet } from 'svelte';
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
    children,
  }: {
    /** The shown page; a maximized section repeats its overview header. */
    page: SubPage;
    title: string;
    /** The section's count, shown like on the overview. */
    count?: number | undefined;
    onBack: () => void;
    /** Page actions at the right end of the header. */
    children?: Snippet;
  } = $props();
</script>

<!-- The section's own header above the scrolling body: the same title, count
     and actions, and the minimize button where the overview has the maximize
     button. The page body is labelled by its title. -->
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
