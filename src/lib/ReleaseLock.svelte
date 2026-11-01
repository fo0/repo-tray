<script lang="ts" generics="C">
  import { tick } from 'svelte';
  import { errorMessage } from './format';

  let {
    releasing,
    claim,
    onRelease,
  }: {
    /** A release of this claim is in flight. */
    releasing: boolean;
    /** The claim shown right now; the confirmation releases this one. */
    claim?: C;
    /**
     * Releases the claim held since the confirmation opened; never
     * dispatches. Rejects with a user-facing error.
     */
    onRelease: (claim?: C) => Promise<void>;
  } = $props();
  let confirming = $state(false);
  let error = $state('');
  /** The claim the user confirms: as shown when the confirmation opened. */
  let held: C | undefined;
  let ask = $state<HTMLButtonElement>();
  let cancel = $state<HTMLButtonElement>();

  async function open() {
    held = claim;
    confirming = true;
    error = '';
    await tick();
    // The safe choice takes focus first.
    cancel?.focus();
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

{#if !confirming}<button
    type="button"
    class="text-button"
    bind:this={ask}
    onclick={() => void open()}>Sperre aufheben…</button
  >{#if error}<p class="release-error" role="alert">{error}</p>{/if}{:else}<div
    class="release-confirm"
    role="group"
    aria-label="Sperre aufheben"
    aria-describedby="release-hint"
  >
    <p id="release-hint">
      Hebe die Sperre nur auf, wenn du auf GitHub geprüft hast, dass dieser
      Start nicht läuft oder ein erneuter Start gewollt ist. RepoTray startet
      dabei nichts.
    </p>
    <div class="release-actions">
      <button
        type="button"
        class="secondary-button compact"
        disabled={releasing}
        onclick={() => void confirm()}
        >Ich habe die Runs auf GitHub geprüft – Sperre aufheben</button
      ><button
        type="button"
        class="text-button"
        bind:this={cancel}
        disabled={releasing}
        onclick={() => void close()}>Abbrechen</button
      >
    </div>
  </div>{/if}
