<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    onConnected,
    onClose,
    onSettings,
  }: {
    onConnected: (method: 'browser' | 'token') => void;
    onClose: () => void;
    onSettings: () => void;
  } = $props();
  type Step =
    | 'intro'
    | 'pending'
    | 'checking'
    | 'connected'
    | 'cancelled'
    | 'expired'
    | 'denied';
  let step = $state<Step>('intro');
  let method = $state<'browser' | 'token'>('browser');
  let tokenError = $state('');
  let tokenInput = $state<HTMLInputElement>();
  let stepHeading = $state<HTMLHeadingElement>();
  $effect(() => {
    const currentStep = step;
    void tick().then(() => {
      if (step === currentStep) stepHeading?.focus();
    });
  });
  let generation = 0;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let confirmationTimer: ReturnType<typeof setTimeout> | undefined;

  function stopTimers() {
    generation++;
    clearTimeout(expiryTimer);
    clearTimeout(confirmationTimer);
  }
  function begin() {
    stopTimers();
    method = 'browser';
    tokenError = '';
    step = 'pending';
    const ticket = generation;
    expiryTimer = setTimeout(() => {
      if (ticket === generation && step === 'pending') finish('expired');
    }, 120_000);
  }
  function finish(next: 'cancelled' | 'expired' | 'denied') {
    stopTimers();
    if (tokenInput) tokenInput.value = '';
    step = next;
  }
  function confirm() {
    if (step !== 'pending') return;
    verifyExample();
  }
  function verifyExample() {
    stopTimers();
    step = 'checking';
    const ticket = generation;
    confirmationTimer = setTimeout(() => {
      if (ticket !== generation || step !== 'checking') return;
      step = 'connected';
      onConnected(method);
    }, 400);
  }
  function submitExampleToken(event: SubmitEvent) {
    event.preventDefault();
    // The input is transient DOM data, never Svelte state, storage, logs or IPC.
    const isExample = tokenInput?.value === 'demo-token';
    if (tokenInput) tokenInput.value = '';
    if (!isExample) {
      tokenError =
        'Hier ist nur der Beispielwert demo-token erlaubt. Es wurde nichts gespeichert.';
      return;
    }
    tokenError = '';
    method = 'token';
    verifyExample();
  }
  function retry() {
    stopTimers();
    step = 'intro';
    tokenError = '';
  }
  onDestroy(() => {
    stopTimers();
    if (tokenInput) tokenInput.value = '';
  });
</script>

<div class="modal-body connect-body auth-preview">
  {#if step === 'intro'}
    <div class="auth-symbol"><Icon name="github" size={28} /></div>
    <h3 tabindex="-1" bind:this={stepHeading}>Dein GitHub-Konto verbinden</h3>
    <p>
      Vorgesehener Ablauf: GitHub öffnet sich im Standardbrowser. Nach der
      Bestätigung ist RepoTray automatisch verbunden.
    </p>
    <button class="primary-button full-width" onclick={begin}
      ><Icon name="github" size={16} />Mit GitHub anmelden</button
    >
    <p class="auth-disclosure">
      In dieser Vorschau öffnet sich kein Browser. Es wird kein echtes Konto
      verbunden.
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
          /></label
        >
        <p class="field-help">
          Nur <code>demo-token</code> verwenden. Echte Tokens werden hier weder benötigt
          noch gespeichert.
        </p>
        {#if tokenError}<div class="alert warning" role="alert">
            {tokenError}
          </div>{/if}
        <button type="submit" class="secondary-button"
          >Token prüfen und verbinden</button
        >
      </form>
    </details>
  {:else if step === 'pending'}
    <div class="auth-symbol"><Icon name="external" size={27} /></div>
    <h3 tabindex="-1" bind:this={stepHeading}>Im Browser bestätigen</h3>
    <p>
      Für die spätere Anmeldung öffnet RepoTray GitHub im Standardbrowser. Prüfe
      dort das angemeldete Konto und bestätige den kurzen Code.
    </p>
    <div class="auth-code">
      <span>Beispielcode · Demo</span><code>DEMO-1234</code><small
        >Nur Vorschau · 2 Minuten gültig</small
      >
    </div>
    <ol class="auth-steps">
      <li>GitHub im Browser öffnen.</li>
      <li>Konto prüfen und Code bestätigen.</li>
      <li>RepoTray zeigt die Verbindung automatisch an.</li>
    </ol>
    <p class="auth-disclosure">
      Dieser Schritt wird nur simuliert. Es wird kein Browser geöffnet.
    </p>
    <button class="primary-button full-width" onclick={confirm}
      >Bestätigung simulieren<Icon name="check" size={15} /></button
    >
    <details class="auth-test-states">
      <summary>Weitere Demo-Zustände ansehen</summary>
      <div>
        <button class="text-button" onclick={() => finish('expired')}
          >Code ablaufen lassen</button
        ><button class="text-button" onclick={() => finish('denied')}
          >Ablehnung simulieren</button
        >
      </div>
    </details>
  {:else if step === 'checking'}
    <div class="auth-symbol"><Icon name="refresh" size={27} /></div>
    <h3 tabindex="-1" bind:this={stepHeading}>Anmeldung wird bestätigt …</h3>
    <p>
      Das Beispielkonto wird lokal geprüft. Es findet kein GitHub-Zugriff statt.
    </p>
  {:else if step === 'connected'}
    <div class="auth-symbol"><Icon name="check" size={28} /></div>
    <h3 tabindex="-1" bind:this={stepHeading}>Demo-Konto verbunden</h3>
    <div class="auth-account">
      <span class="mini-avatar">D</span>
      <div><strong>demo-dev</strong><span>Beispielkonto · nur lokal</span></div>
      <Icon name="check" size={17} />
    </div>
    <p>
      {method === 'token'
        ? 'Der Beispiel-Token wurde geprüft und sofort verworfen.'
        : 'Die simulierte Browser-Bestätigung wurde übernommen.'} Ein echtes GitHub-Konto
      ist weiterhin nicht verbunden.
    </p>
    <button class="primary-button full-width" onclick={onClose}
      >Zur App<Icon name="arrow" size={15} /></button
    >
  {:else}
    <div class="auth-symbol"><Icon name="warning" size={28} /></div>
    <h3 tabindex="-1" bind:this={stepHeading}>
      {step === 'expired'
        ? 'Code abgelaufen'
        : step === 'denied'
          ? 'Freigabe abgelehnt'
          : 'Anmeldung abgebrochen'}
    </h3>
    <p>
      {step === 'expired'
        ? 'Dieser Beispielcode ist nicht mehr gültig. Starte die Anmeldung erneut, um einen neuen Ablauf zu beginnen.'
        : step === 'denied'
          ? 'Die Verbindung wurde nicht bestätigt. Dein Konto wurde nicht verbunden.'
          : 'Der Anmeldeversuch wurde beendet. Eine spätere Antwort kann ihn nicht wieder aktivieren.'}
    </p>
    <button class="primary-button full-width" onclick={retry}
      >Erneut versuchen<Icon name="refresh" size={15} /></button
    >
  {/if}
</div>
<div class="modal-actions">
  <button
    class="secondary-button"
    onclick={() =>
      step === 'pending' || step === 'checking'
        ? finish('cancelled')
        : onClose()}
    >{step === 'pending' || step === 'checking'
      ? 'Anmeldung abbrechen'
      : step === 'intro'
        ? 'Abbrechen'
        : 'Schließen'}</button
  ><button class="text-button" onclick={onSettings}
    >Einstellungen<Icon name="arrow" size={14} /></button
  >
</div>
