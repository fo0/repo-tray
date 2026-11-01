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
    actionLabel: string;
    onAction: () => void;
    onDismiss: () => void;
  } = $props();
</script>

<!-- Same look as the plain notice in StatusBanners, plus one follow-up action. -->
<div class={`alert ${tone} notice-banner`} role="status">
  <Icon name={tone === 'subtle' ? 'check' : 'warning'} size={16} /><span
    >{text}</span
  ><button class="text-button" onclick={() => onAction()}
    >{actionLabel}<Icon name="arrow" size={13} /></button
  ><button
    class="icon-button small"
    aria-label="Meldung schließen"
    onclick={() => onDismiss()}><Icon name="close" size={13} /></button
  >
</div>
