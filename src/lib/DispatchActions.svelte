<script lang="ts">
  import Icon from './Icon.svelte';

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

{#if starting}<p
    class="dialog-alert alert subtle"
    id="start-continues"
    role="status"
  >
    <Icon name="refresh" size={14} /><span
      >Der Start läuft weiter, auch wenn du den Dialog schließt. Das Ergebnis
      erscheint dann im Panel.</span
    >
  </p>{/if}
<div class="modal-actions">
  <button
    type="button"
    class="secondary-button"
    onclick={() => onClose()}
    aria-describedby={starting ? 'start-continues' : undefined}
    >{finished || starting ? 'Schließen' : 'Abbrechen'}</button
  ><button
    type="button"
    class="primary-button"
    onclick={() => onStart()}
    disabled={starting || !canStart}
    title={starting || !canStart ? (reason ?? undefined) : undefined}
    >{starting
      ? demo
        ? 'Simuliert …'
        : 'Startet …'
      : demo
        ? 'Start simulieren'
        : 'Workflow starten'}<Icon name="play" size={14} /></button
  >
</div>
