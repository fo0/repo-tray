<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import BrowserSignInUnavailable from './BrowserSignInUnavailable.svelte';

  let {
    onConnected,
    onClose,
    onSettings,
  }: {
    onConnected: (method: 'browser' | 'token') => void;
    onClose: () => void;
    onSettings: () => void;
  } = $props();
  let step = $state<'intro' | 'checking' | 'cancelled'>('intro');
  let tokenError = $state('');
  let tokenInput = $state<HTMLInputElement>();
  let stepHeading = $state<HTMLHeadingElement>();
  let hasToken = $state(false);
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const current = step;
    void tick().then(() => {
      if (step === current) stepHeading?.focus();
    });
  });
  function stop() {
    generation++;
    clearTimeout(timer);
  }
  function submitExampleToken(event: SubmitEvent) {
    event.preventDefault();
    if (step !== 'intro' || !hasToken) return;
    const isExample = tokenInput?.value === 'demo-token';
    if (tokenInput) tokenInput.value = '';
    hasToken = false;
    if (!isExample) {
      tokenError =
        'Hier funktioniert nur der Beispielwert „demo-token“. Es wurde nichts gespeichert.';
      return;
    }
    tokenError = '';
    stop();
    step = 'checking';
    const ticket = generation;
    timer = setTimeout(() => {
      if (ticket === generation && step === 'checking') onConnected('token');
    }, 400);
  }
  function cancel() {
    stop();
    step = 'cancelled';
  }
  onDestroy(() => {
    stop();
    if (tokenInput) tokenInput.value = '';
  });
</script>

<div class="modal-body connect-body auth-preview">
  {#if step === 'intro'}
    <div class="auth-symbol"><Icon name="github" size={28} /></div>
    <h3 tabindex="-1" bind:this={stepHeading}>Dein GitHub-Konto verbinden</h3>
    <BrowserSignInUnavailable demo />
    <p class="auth-disclosure">
      Diese Vorschau verwendet lokale Demo-Konten. Echte Anmeldungen erfolgen
      nur in der Desktop-App.
    </p>
    <details class="token-path">
      <summary
        >Alternativ: Token hinterlegen<Icon name="down" size={13} /></summary
      >
      <form onsubmit={submitExampleToken}>
        <p>
          Im normalen Betrieb wird der Token nach der Prüfung sicher im
          Betriebssystem-Tresor gespeichert.
        </p>
        <label class="field"
          ><span>Beispiel-Token</span><input
            type="password"
            aria-label="Beispiel-Token"
            bind:this={tokenInput}
            autocomplete="off"
            spellcheck="false"
            maxlength="4096"
            placeholder="demo-token"
            oninput={(event) =>
              (hasToken = event.currentTarget.value.trim().length > 0)}
          /></label
        >
        <p class="field-help">
          Nur <code>demo-token</code> verwenden. Echte Tokens werden hier weder benötigt
          noch gespeichert.
        </p>
        {#if tokenError}<div class="alert warning" role="alert">
            {tokenError}
          </div>{/if}
        <button type="submit" class="secondary-button" disabled={!hasToken}
          >Token prüfen und verbinden</button
        >
      </form>
    </details>
  {:else if step === 'checking'}
    <div class="auth-symbol"><Icon name="refresh" size={27} /></div>
    <h3 tabindex="-1" bind:this={stepHeading}>Anmeldung wird bestätigt …</h3>
    <p>
      Das Beispielkonto wird lokal geprüft. Es findet kein GitHub-Zugriff statt.
    </p>
  {:else}
    <div class="auth-symbol"><Icon name="warning" size={28} /></div>
    <h3 tabindex="-1" bind:this={stepHeading}>Anmeldung abgebrochen</h3>
    <p>
      Der Anmeldeversuch wurde beendet. Eine spätere Antwort kann ihn nicht
      wieder aktivieren.
    </p>
    <button
      class="primary-button full-width"
      onclick={() => {
        step = 'intro';
        tokenError = '';
      }}>Erneut versuchen<Icon name="refresh" size={15} /></button
    >
  {/if}
</div>
<div class="modal-actions">
  <button
    class="secondary-button"
    onclick={() => (step === 'checking' ? cancel() : onClose())}
    >{step === 'checking'
      ? 'Anmeldung abbrechen'
      : step === 'intro'
        ? 'Abbrechen'
        : 'Schließen'}</button
  >
  <button class="text-button" onclick={onSettings}
    >Einstellungen<Icon name="arrow" size={14} /></button
  >
</div>
