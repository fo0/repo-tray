<script lang="ts" generics="C">
  import { tick } from 'svelte';
  import InlineConfirm from './InlineConfirm.svelte';
  import { errorMessage } from './format';

  let {
    releasing,
    claim,
    onRelease,
  }: {
    /** A release of this claim is in flight. */
    releasing: boolean;
    /** The claim shown right now; the confirmation releases this one. */
    claim?: C | undefined;
    /**
     * Releases the claim held since the confirmation opened; never
     * dispatches. Rejects with a user-facing error.
     */
    onRelease: (claim?: C) => Promise<void>;
  } = $props();
  /** Unique per instance, so label and description IDs never collide. */
  const uid = $props.id();
  let confirming = $state(false);
  let error = $state('');
  /** The claim the user confirms: as shown when the confirmation opened. */
  let held: C | undefined;
  let ask = $state<HTMLButtonElement>();

  // The question takes focus on its safe choice (InlineConfirm), so Enter
  // right after opening releases nothing.
  function open() {
    held = claim;
    confirming = true;
    error = '';
  }
  async function close() {
    confirming = false;
    error = '';
    await tick();
    ask?.focus();
  }
  async function confirm() {
    error = '';
    try {
      await onRelease(held);
    } catch (cause) {
      // A refusal ends this confirmation: the claim may have changed, so a
      // retry asks again. The reason stays visible.
      confirming = false;
      error = errorMessage(cause);
      await tick();
      ask?.focus();
    }
  }
</script>

<!-- Escape cancels only this question, never the start dialog; while the
     release runs both buttons stay focusable (aria-disabled). -->
{#if !confirming}<button
    type="button"
    class="text-button"
    bind:this={ask}
    onclick={open}>Sperre aufheben…</button
  >{#if error}<p class="release-error" role="alert">
      {error}
    </p>{/if}{:else}<InlineConfirm
    id={`release-${uid}`}
    tone="caution"
    title="Sperre aufheben?"
    text="Hebe die Sperre nur auf, wenn du auf GitHub geprüft hast, dass dieser Start nicht läuft oder ein erneuter Start gewollt ist. RepoTray startet dabei nichts."
    confirmLabel="Ich habe die Runs auf GitHub geprüft – Sperre aufheben"
    busyLabel="Sperre wird aufgehoben …"
    busy={releasing}
    onConfirm={() => void confirm()}
    onCancel={() => void close()}
  />{/if}
