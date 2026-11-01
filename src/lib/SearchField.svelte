<script lang="ts">
  import Icon from './Icon.svelte';
  import type { ViewTab } from './ViewTabs.svelte';

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
</script>

<label class="search-field"
  ><Icon name="search" size={17} /><input
    bind:this={input}
    aria-label={tab === 'activity'
      ? 'Aktivität durchsuchen'
      : tab === 'repositories'
        ? 'Repositories durchsuchen'
        : 'Favoriten und Workflows durchsuchen'}
    placeholder={tab === 'activity'
      ? 'Repository, Workflow oder Branch suchen …'
      : tab === 'repositories'
        ? 'Repository oder Workflow suchen …'
        : 'Favoriten und Workflows suchen …'}
    bind:value={query}
  />{#if query}<button
      class="icon-button small"
      aria-label="Suche leeren"
      onclick={() => (query = '')}><Icon name="close" size={14} /></button
    >{:else}<kbd>/</kbd>{/if}</label
>
