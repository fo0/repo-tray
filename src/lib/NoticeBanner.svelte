<script lang="ts">
  import Icon from './Icon.svelte';
  import type { NoticeTone } from './StatusBanners.svelte';

  let {
    text,
    tone,
    actionLabel,
    onAction,
    navigates = true,
    timeout,
    paused = false,
    onDismiss,
  }: {
    text: string;
    tone: NoticeTone;
    /** Optional follow-up action, e.g. „In Aktivität anzeigen“. */
    actionLabel?: string;
    onAction?: () => void;
    /** The action leads elsewhere (arrow icon) rather than acting in place. */
    navigates?: boolean;
    /** Closes after this many milliseconds; paused while hovered or focused. */
    timeout?: number;
    /** Holds the timeout, e.g. while a dialog hides the notice; restarts in full after. */
    paused?: boolean;
    onDismiss: () => void;
  } = $props();
  let hovered = $state(false);
  let focused = $state(false);

  $effect(() => {
    if (!timeout || hovered || focused || paused) return;
    // Starts over once the pointer and focus have left the notice and no
    // dialog hides it any more.
    const timer = setTimeout(() => onDismiss(), timeout);
    return () => clearTimeout(timer);
  });

  /** Tracks whether the pointer or the focus is inside the notice. */
  function engagement(node: HTMLElement) {
    const enter = () => (hovered = true);
    const leave = () => (hovered = false);
    const focusIn = () => (focused = true);
    const focusOut = (event: FocusEvent) =>
      (focused =
        event.relatedTarget instanceof Node &&
        node.contains(event.relatedTarget));
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('focusin', focusIn);
    node.addEventListener('focusout', focusOut);
    return {
      destroy() {
        node.removeEventListener('pointerenter', enter);
        node.removeEventListener('pointerleave', leave);
        node.removeEventListener('focusin', focusIn);
        node.removeEventListener('focusout', focusOut);
      },
    };
  }
</script>

<div
  class={`alert ${tone} notice-banner`}
  role={tone === 'danger' ? 'alert' : 'status'}
  use:engagement
>
  <Icon name={tone === 'subtle' ? 'check' : 'warning'} size={16} /><span
    >{text}</span
  >{#if actionLabel && onAction}<button
      class="text-button"
      onclick={() => onAction()}
      >{actionLabel}{#if navigates}<Icon name="arrow" size={13} />{/if}</button
    >{/if}<button
    class="icon-button small"
    aria-label="Meldung schließen"
    onclick={() => onDismiss()}><Icon name="close" size={13} /></button
  >
</div>
