<script module lang="ts">
  import type { IconName } from './Icon.svelte';
  import type { SectionPage } from './view.svelte';

  /** Singular and plural of each section's spoken count. */
  export const SECTION_UNITS: Record<SectionPage, [one: string, many: string]> =
    {
      runs: ['Run', 'Runs'],
      favorites: ['Favorit', 'Favoriten'],
      repos: ['Repository', 'Repositories'],
    };
  /** The icon before a section's title, where it has one. */
  export const SECTION_ICONS: Partial<Record<SectionPage, IconName>> = {
    favorites: 'heart',
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { plural } from './format';
  import { sectionKey } from './shortcuts';

  let {
    page,
    id,
    title,
    count,
    unit,
    icon,
    live = false,
    onMaximize,
    onMinimize,
    children,
  }: {
    /** The page the maximize button opens. */
    page: SectionPage;
    /** The heading's id; the section is labelled by it. */
    id: string;
    title: string;
    /** Left out, the header shows no count. */
    count?: number | undefined;
    /** Singular and plural for the spoken count, e.g. „Run“, „Runs“. */
    unit: [one: string, many: string];
    icon?: IconName | undefined;
    /** Marks the section of running work with the live dot. */
    live?: boolean;
    onMaximize?: () => void;
    /**
     * Makes this the header of the maximized page: its title is the page's
     * focus landing, and the button in the maximize button's place minimizes.
     */
    onMinimize?: (() => void) | undefined;
    /** Further header actions, left of the maximize button. */
    children?: Snippet;
  } = $props();
  const key = $derived(sectionKey(page));
  const maximized = $derived(!!onMinimize);
</script>

{#snippet heading()}{#if live}<span class="live-dot"></span>{:else if icon}<Icon
      name={icon}
      size={13}
    />{/if}{title}{/snippet}

<div class="section-header">
  {#if maximized}<h2 {id} class="page-title" tabindex="-1" data-focus-landing>
      {@render heading()}
    </h2>{:else}<h2 {id}>{@render heading()}</h2>{/if}
  {#if count !== undefined}<span class="section-count"
      ><span aria-hidden="true">{count}</span><span class="sr-only"
        >{plural(count, ...unit)}</span
      ></span
    >{/if}
  <!-- One toggle in one place: the overview's maximize button becomes the
       page's minimize button. Only the overview's carries `data-maximize`,
       where focus returns when a page closes. -->
  <span class="section-actions">
    {@render children?.()}{#if onMinimize}<button
        class="icon-button section-maximize"
        aria-label={`${title} verkleinern`}
        aria-keyshortcuts={`Escape Control+${key}`}
        title="Verkleinern · Esc"
        onclick={() => onMinimize()}><Icon name="minimize" size={15} /></button
      >{:else}<button
        class="icon-button section-maximize"
        data-maximize={page}
        aria-label={`${title} maximieren`}
        aria-keyshortcuts={`Control+${key}`}
        title={`Maximieren · Strg+${key}`}
        onclick={() => onMaximize?.()}
        ><Icon name="maximize" size={15} /></button
      >{/if}
  </span>
</div>
