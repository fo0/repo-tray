<script module lang="ts">
  import type { IconName } from './Icon.svelte';

  export interface EmptyAction {
    label: string;
    icon: IconName;
    run: () => void;
    /** Finds the button again after a page closed (`PanelView.back`). */
    focusKey?: string;
  }
  /** The missing setup step every page names alike: account or repositories. */
  export interface NextStep {
    title: string;
    text: string;
    action: EmptyAction;
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    icon,
    iconSize,
    framed = true,
    title,
    text,
    action,
  }: {
    icon: IconName;
    iconSize: number;
    /** Wraps the icon in the round `.empty-icon` badge. */
    framed?: boolean;
    title: string;
    text: string;
    action?: EmptyAction | undefined;
  } = $props();
</script>

<div class="empty-state">
  {#if framed}<span class="empty-icon"
      ><Icon name={icon} size={iconSize} /></span
    >{:else}<Icon name={icon} size={iconSize} />{/if}
  <h2>{title}</h2>
  <p>{text}</p>
  {#if action}<button
      class="text-button"
      data-focus-key={action.focusKey}
      onclick={() => action.run()}
      >{action.label}<Icon name={action.icon} size={14} /></button
    >{/if}
</div>
