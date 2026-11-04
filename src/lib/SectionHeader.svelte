<script module lang="ts">
  import type { IconName } from './Icon.svelte';
  import { m } from './i18n/index.svelte';
  import type { SectionPage } from './view.svelte';

  /** A section's spoken count, e.g. „3 Runs“, in the language in effect. */
  export const sectionCount = (page: SectionPage, count: number) =>
    m().common.count[page](count);
  /** The icon before a section's title, where it has one. */
  export const SECTION_ICONS: Partial<Record<SectionPage, IconName>> = {
    favorites: 'heart',
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { sectionKey } from './shortcuts';

  let {
    page,
    id,
    title,
    count,
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
    /** Left out, the header shows no count; spoken with the page's noun. */
    count?: number | undefined;
    icon?: IconName | undefined;
    /** Marks the section of running work with the live dot. */
    live?: boolean;
    onMaximize?: () => void;
    /**
     * Makes this the header of the maximized page: its title is the page's
     * focus landing, and the back arrow in the maximize button's place returns
     * to the overview.
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
        >{sectionCount(page, count)}</span
      ></span
    >{/if}
  <!-- One toggle in one place: the overview's maximize button becomes the
       page's back arrow. Only the overview's carries `data-maximize`, where
       focus returns when a page closes. -->
  <span class="section-actions">
    {@render children?.()}{#if onMinimize}<button
        class="icon-button section-maximize"
        aria-label={m().shell.sections.back}
        aria-keyshortcuts={`Escape Control+${key}`}
        title={m().shell.sections.backTitle}
        onclick={() => onMinimize()}><Icon name="back" size={15} /></button
      >{:else}<button
        class="icon-button section-maximize"
        data-maximize={page}
        aria-label={m().shell.sections.maximize(title)}
        aria-keyshortcuts={`Control+${key}`}
        title={m().shell.sections.maximizeTitle(key)}
        onclick={() => onMaximize?.()}
        ><Icon name="maximize" size={15} /></button
      >{/if}
  </span>
</div>
