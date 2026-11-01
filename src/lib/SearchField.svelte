<script lang="ts">
  import Icon from './Icon.svelte';
  import type { ViewTab } from './ViewTabs.svelte';
  import { SHORTCUT_HINT } from './shortcuts';

  let {
    tab,
    query = $bindable(),
  }: {
    tab: ViewTab;
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

<label class="search-field"
  ><Icon name="search" size={17} /><input
    bind:this={input}
    aria-label={tab === 'activity'
      ? 'Aktivität durchsuchen'
      : tab === 'repositories'
        ? 'Repositories durchsuchen'
        : 'Favoriten und Workflows durchsuchen'}
    aria-keyshortcuts="/"
    placeholder={tab === 'activity'
      ? 'Repository, Workflow oder Branch suchen …'
      : tab === 'repositories'
        ? 'Repository oder Workflow suchen …'
        : 'Favoriten und Workflows suchen …'}
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
