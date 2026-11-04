<script lang="ts">
  import Icon from './Icon.svelte';
  import { m } from './i18n/index.svelte';

  let {
    demo,
    starting,
    finished,
    canStart,
    reason,
    onClose,
    onStart,
  }: {
    demo: boolean;
    /** A start for the dialog's target is running. */
    starting: boolean;
    /** The dialog shows a start result. */
    finished: boolean;
    canStart: boolean;
    /** Why the start button is disabled, shown as its tooltip. */
    reason: string | null;
    onClose: () => void;
    onStart: () => void;
  } = $props();
</script>

{#if starting}<p class="dialog-alert subtle" id="start-continues" role="status">
    <Icon name="refresh" size={14} /><span
      >{m().dispatch.actions.continues}</span
    >
  </p>{/if}
<div class="modal-actions">
  <button
    type="button"
    class="secondary-button"
    onclick={() => onClose()}
    aria-describedby={starting ? 'start-continues' : undefined}
    >{finished || starting ? m().common.close : m().common.cancel}</button
  ><!-- Off via aria-disabled, not disabled: the running start keeps focus
       here instead of dropping it to <body> inside the dialog. --><button
    type="button"
    class="primary-button"
    onclick={() => !starting && canStart && onStart()}
    aria-disabled={starting || !canStart ? 'true' : undefined}
    title={starting || !canStart ? (reason ?? undefined) : undefined}
    >{starting
      ? demo
        ? m().dispatch.actions.simulating
        : m().dispatch.actions.starting
      : demo
        ? m().dispatch.actions.simulate
        : m().dispatch.actions.start}<Icon name="play" size={14} /></button
  >
</div>
