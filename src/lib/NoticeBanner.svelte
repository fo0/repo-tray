<script lang="ts">
  import Icon from './Icon.svelte';
  import type { NoticeTone } from './StatusBanners.svelte';

  let {
    text,
    tone,
    actionLabel,
    onAction,
    onDismiss,
  }: {
    text: string;
    tone: NoticeTone;
    /** Optional follow-up action, e.g. „In Aktivität anzeigen“. */
    actionLabel?: string;
    onAction?: () => void;
    onDismiss: () => void;
  } = $props();
</script>

<div
  class={`alert ${tone} notice-banner`}
  role={tone === 'danger' ? 'alert' : 'status'}
>
  <Icon name={tone === 'subtle' ? 'check' : 'warning'} size={16} /><span
    >{text}</span
  >{#if actionLabel && onAction}<button
      class="text-button"
      onclick={() => onAction()}
      >{actionLabel}<Icon name="arrow" size={13} /></button
    >{/if}<button
    class="icon-button small"
    aria-label="Meldung schließen"
    onclick={() => onDismiss()}><Icon name="close" size={13} /></button
  >
</div>
