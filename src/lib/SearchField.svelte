<script module lang="ts">
  import type { Page } from './view.svelte';

  /** What the field searches on each page: its name and its placeholder. */
  const LABELS: Record<Page, [label: string, placeholder: string]> = {
    overview: [
      'Übersicht durchsuchen',
      'Workflow, Repository oder Branch suchen …',
    ],
    runs: ['Verlauf durchsuchen', 'Repository, Workflow oder Branch suchen …'],
    favorites: ['Favoriten durchsuchen', 'Favorit oder Repository suchen …'],
    repos: ['Repositories durchsuchen', 'Repository oder Workflow suchen …'],
  };
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import { SHORTCUT_HINT } from './shortcuts';

  let {
    page,
    query = $bindable(),
  }: {
    /** The shown page; the search filters what it lists. */
    page: Page;
    query: string;
  } = $props();

  let input = $state<HTMLInputElement>();

  /** Target of the global `/` shortcut. */
  export function focus() {
    input?.focus();
  }

  /** Escape in the field clears the query first, then leaves the field. */
  export function escape(target: EventTarget | null) {
    if (!input || target !== input) return false;
    if (query) query = '';
    else input.blur();
    return true;
  }
</script>

<!-- On the overview the field is where focus lands when nothing better is
     left; a maximized section lands on its title instead. -->
<label class="search-field"
  ><Icon name="search" size={17} /><input
    bind:this={input}
    aria-label={LABELS[page][0]}
    aria-keyshortcuts="/"
    placeholder={LABELS[page][1]}
    data-focus-landing={page === 'overview' ? true : undefined}
    bind:value={query}
  />{#if query}<button
      class="icon-button small"
      aria-label="Suche leeren"
      onclick={() => {
        query = '';
        // The button goes with the query; focus stays in the field.
        input?.focus();
      }}><Icon name="close" size={14} /></button
    >{:else}<kbd title={SHORTCUT_HINT}>/</kbd>{/if}</label
>
