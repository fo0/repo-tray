<script lang="ts">
  import { onMount } from 'svelte';

  let {
    id,
    title,
    text,
    confirmLabel,
    cancelLabel = 'Abbrechen',
    busyLabel,
    busy = false,
    onConfirm,
    onCancel,
  }: {
    /** Prefix for the label and description IDs; unique per confirmation. */
    id: string;
    title: string;
    text: string;
    /** The destructive action, styled as danger. */
    confirmLabel: string;
    cancelLabel?: string;
    /** Confirm label while the action runs. */
    busyLabel?: string;
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();
  let cancel = $state<HTMLButtonElement>();

  /** Escape cancels only this confirmation, never the surrounding dialog. */
  function escapeCancels(node: HTMLElement) {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      onCancel();
    };
    node.addEventListener('keydown', onKey);
    return { destroy: () => node.removeEventListener('keydown', onKey) };
  }

  // The safe choice gets focus, so Enter right after opening never destroys anything.
  onMount(() => cancel?.focus());
</script>

<div
  class="inline-confirm"
  role="group"
  aria-labelledby={`${id}-title`}
  aria-describedby={`${id}-text`}
  use:escapeCancels
>
  <p>
    <strong id={`${id}-title`}>{title}</strong>
    <span id={`${id}-text`}>{text}</span>
  </p>
  <div class="inline-confirm-actions">
    <button
      type="button"
      class="secondary-button"
      bind:this={cancel}
      onclick={() => onCancel()}>{cancelLabel}</button
    >
    <button
      type="button"
      class="danger-button"
      disabled={busy}
      onclick={() => onConfirm()}
      >{busy && busyLabel ? busyLabel : confirmLabel}</button
    >
  </div>
</div>
