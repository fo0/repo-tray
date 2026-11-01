<script lang="ts">
  import { tick } from 'svelte';
  import { errorMessage } from './format';

  let {
    releasing,
    onRelease,
  }: {
    /** A release of this claim is in flight. */
    releasing: boolean;
    /** Releases the claim; never dispatches. Rejects with a user-facing error. */
    onRelease: () => Promise<void>;
  } = $props();
  let confirming = $state(false);
  let error = $state('');
  let ask = $state<HTMLButtonElement>();
  let cancel = $state<HTMLButtonElement>();

  async function open() {
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
      await onRelease();
    } catch (cause) {
      error = errorMessage(cause);
    }
  }
</script>

{#if !confirming}<button
    type="button"
    class="text-button"
    bind:this={ask}
    onclick={() => void open()}>Sperre aufheben…</button
  >{:else}<div
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
    {#if error}<p class="release-error" role="alert">{error}</p>{/if}
  </div>{/if}
