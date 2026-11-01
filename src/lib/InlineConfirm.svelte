<script lang="ts">
  import { onMount } from 'svelte';

  let {
    id,
    title,
    text,
    warning,
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
    /** A consequence the user must weigh first; its own line under the text. */
    warning?: string | undefined;
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

  /**
   * Escape cancels only this confirmation, never the surrounding dialog. While
   * the action runs it is swallowed: the action finishes either way.
   */
  function escapeCancels(node: HTMLElement) {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      if (!busy) onCancel();
    };
    node.addEventListener('keydown', onKey);
    return { destroy: () => node.removeEventListener('keydown', onKey) };
  }

  // The safe choice gets focus, so Enter right after opening never destroys anything.
  onMount(() => cancel?.focus());
  // While busy both buttons stay focusable (aria-disabled, not disabled), so focus
  // never drops to <body> where Escape would close the surrounding dialog.
  const unlessBusy = (action: () => void) => () => {
    if (!busy) action();
  };
</script>

<div
  class="inline-confirm"
  role="group"
  aria-labelledby={`${id}-title`}
  aria-describedby={warning ? `${id}-text ${id}-warning` : `${id}-text`}
  use:escapeCancels
>
  <p>
    <strong id={`${id}-title`}>{title}</strong>
    <span id={`${id}-text`}>{text}</span>
    {#if warning}<span class="inline-confirm-warning" id={`${id}-warning`}
        >{warning}</span
      >{/if}
  </p>
  <div class="inline-confirm-actions">
    <button
      type="button"
      class="secondary-button"
      bind:this={cancel}
      aria-disabled={busy ? 'true' : undefined}
      onclick={unlessBusy(onCancel)}>{cancelLabel}</button
    >
    <button
      type="button"
      class="danger-button"
      aria-disabled={busy ? 'true' : undefined}
      onclick={unlessBusy(onConfirm)}
      >{busy && busyLabel ? busyLabel : confirmLabel}</button
    >
  </div>
</div>
