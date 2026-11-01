<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import { plural } from './format';
  import { sectionKey } from './shortcuts';
  import type { SectionPage } from './view.svelte';

  let {
    page,
    id,
    title,
    count,
    unit,
    icon,
    live = false,
    onMaximize,
    children,
  }: {
    /** The page the maximize button opens. */
    page: SectionPage;
    /** The heading's id; the section is labelled by it. */
    id: string;
    title: string;
    count: number;
    /** Singular and plural for the spoken count, e.g. „Run“, „Runs“. */
    unit: [one: string, many: string];
    icon?: IconName | undefined;
    /** Marks the section of running work with the live dot. */
    live?: boolean;
    onMaximize: () => void;
    /** Further header actions, left of the maximize button. */
    children?: Snippet;
  } = $props();
  const key = $derived(sectionKey(page));
</script>

<div class="section-header">
  <h2 {id}>
    {#if live}<span class="live-dot"></span>{:else if icon}<Icon
        name={icon}
        size={13}
      />{/if}{title}
  </h2>
  <span class="section-count"
    ><span aria-hidden="true">{count}</span><span class="sr-only"
      >{plural(count, ...unit)}</span
    ></span
  >
  <span class="section-actions">
    {@render children?.()}<button
      class="icon-button section-maximize"
      data-maximize={page}
      aria-label={`${title} maximieren`}
      aria-keyshortcuts={`Control+${key}`}
      title={`Maximieren · Strg+${key}`}
      onclick={() => onMaximize()}><Icon name="maximize" size={15} /></button
    >
  </span>
</div>
