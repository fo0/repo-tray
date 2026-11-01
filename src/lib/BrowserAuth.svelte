<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { errorMessage } from './format';
  import { call } from './ipc';
  import type { DeviceFlowStatus, Snapshot } from './types';
  /** The native flow status plus the panel's own starting and error states. */
  type Status = DeviceFlowStatus | { state: 'starting' | 'error' };
  let {
    onConnected,
    onBusy,
    disabled = false,
  }: {
    onConnected: (snapshot: Snapshot) => void;
    onBusy: (busy: boolean) => void;
    disabled?: boolean;
  } = $props();
  let configured = $state(false);
  let loaded = $state(false);
  let status = $state<Status>({ state: 'idle' });
  let message = $state('');
  let copied = $state(false);
  let busy = $state(false);
  let active = true;
  let generation = 0;
  let flowId = 0;
  let timer: ReturnType<typeof setTimeout>;
  onMount(() => {
    void call('browser_auth_config')
      .then((config) => {
        if (active) configured = config?.configured === true;
      })
      .catch(() => {})
      .finally(() => {
        if (active) loaded = true;
      });
  });
  function setBusy(value: boolean) {
    busy = value;
    onBusy(value);
  }
  function schedule(ticket: number) {
    clearTimeout(timer);
    if (
      !active ||
      ticket !== generation ||
      status.state !== 'awaitingAuthorization'
    )
      return;
    const now = Date.now() / 1000;
    const due = Math.min(status.nextPollAt, status.expiresAt);
    timer = setTimeout(
      () => void poll(ticket),
      Math.max(250, (due - now) * 1000),
    );
  }
  async function poll(ticket: number) {
    try {
      const reply = await call('poll_browser_auth', { flowId });
      if (!active || ticket !== generation || reply.flowId !== flowId) return;
      status = reply.status;
      message = reply.message ?? '';
      if (reply.snapshot) {
        setBusy(false);
        onConnected(reply.snapshot);
        return;
      }
      if (status.state !== 'awaitingAuthorization') setBusy(false);
      schedule(ticket);
    } catch (cause) {
      if (!active || ticket !== generation) return;
      status = { state: 'error' };
      message = errorMessage(
        cause,
        'Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen.',
      );
      setBusy(false);
      void call('cancel_connect').catch(() => {});
    }
  }
  async function openBrowser() {
    try {
      await call('open_browser_auth', { flowId });
    } catch (cause) {
      if (active)
        message = errorMessage(
          cause,
          'Öffne github.com/login/device und gib den Code ein.',
        );
    }
  }
  async function begin() {
    if (disabled || busy || !configured) return;
    const ticket = ++generation;
    clearTimeout(timer);
    setBusy(true);
    message = '';
    copied = false;
    status = { state: 'starting' };
    try {
      const reply = await call('start_browser_auth');
      if (!active || ticket !== generation) return;
      flowId = reply.flowId;
      status = reply.status;
      await openBrowser();
      schedule(ticket);
    } catch (cause) {
      if (!active || ticket !== generation) return;
      status = { state: 'error' };
      message = errorMessage(cause, 'Anmeldung konnte nicht gestartet werden.');
      setBusy(false);
    }
  }
  async function cancel() {
    generation++;
    clearTimeout(timer);
    status = { state: 'cancelled' };
    message = '';
    copied = false;
    // Keep alternatives disabled until cancellation reaches the backend.
    try {
      await call('cancel_connect');
    } catch {
      if (active)
        message =
          'Abbruch konnte nicht bestätigt werden. Schließe dieses Fenster vor einem neuen Versuch.';
      return;
    }
    if (active) setBusy(false);
  }
  async function copyCode() {
    if (status.state !== 'awaitingAuthorization') return;
    try {
      await navigator.clipboard.writeText(status.userCode);
      if (active) copied = true;
    } catch {
      if (active) message = 'Code bitte markieren und kopieren.';
    }
  }
  async function install() {
    try {
      await call('open_browser_installation');
    } catch (cause) {
      if (active)
        message = errorMessage(cause, 'GitHub konnte nicht geöffnet werden.');
    }
  }
  onDestroy(() => {
    active = false;
    generation++;
    clearTimeout(timer);
    onBusy(false);
    if (busy) void call('cancel_connect').catch(() => {});
  });
</script>

<div class="browser-auth" aria-live="polite">
  {#if status.state === 'starting'}
    <p role="status">GitHub-Anmeldung wird vorbereitet …</p>
    <button type="button" class="secondary-button" onclick={cancel}
      >Anmeldung abbrechen</button
    >
  {:else if status.state === 'awaitingAuthorization'}
    <h4>Im Browser bestätigen</h4>
    <p>
      Prüfe auf <strong>github.com/login/device</strong> dein Konto und gib diesen
      Code ein:
    </p>
    <div class="auth-code">
      <span>GitHub-Bestätigungscode</span><code>{status.userCode}</code>
      <button type="button" class="text-button" onclick={copyCode}
        >{copied ? 'Code kopiert' : 'Code kopieren'}</button
      >
      <small
        >Gültig bis {new Date(
          (status.expiresAt ?? 0) * 1000,
        ).toLocaleTimeString('de-DE', {
          hour: '2-digit',
          minute: '2-digit',
        })}</small
      >
    </div>
    <p class="field-help">
      Warte auf GitHub … Die Verbindung wird automatisch erkannt. App
      autorisieren und Repository-Zugriff sind getrennte Freigaben.
    </p>
    <div class="browser-actions">
      <button type="button" class="secondary-button" onclick={openBrowser}
        >GitHub erneut öffnen<Icon name="external" size={14} /></button
      >
      <button type="button" class="text-button" onclick={cancel}
        >Anmeldung abbrechen</button
      >
    </div>
  {:else}
    {#if status.state === 'cancelled'}<p role="status">
        Anmeldung abgebrochen. Dieser Versuch wird nicht mehr übernommen.
      </p>
    {:else if status.state === 'expired'}<p role="status">
        Code abgelaufen. Starte die Anmeldung für einen neuen Code erneut.
      </p>
    {:else if status.state === 'denied'}<p role="status">
        Freigabe bei GitHub abgelehnt. Es wurde kein Konto verbunden.
      </p>{/if}
    <button
      type="button"
      class="primary-button full-width"
      disabled={disabled || busy || !configured || !loaded}
      onclick={begin}
    >
      <Icon name="github" size={16} />{!loaded
        ? 'Anmeldung wird geprüft …'
        : !configured
          ? 'Mit GitHub anmelden · noch nicht eingerichtet'
          : status.state === 'idle'
            ? 'Mit GitHub anmelden'
            : 'Erneut mit GitHub anmelden'}
    </button>
    <p class="field-help">
      {configured
        ? 'GitHub öffnet sich im Systembrowser. Bestätige dort den kurzen Code; RepoTray erkennt die Anmeldung automatisch.'
        : 'Für diese App-Version fehlen noch Client-ID und Gerätecode-Freigabe der Herausgeber-App. Token und lokale Anmeldung sind verfügbar.'}
    </p>
    {#if configured}
      <button
        type="button"
        class="text-button"
        disabled={busy || disabled}
        onclick={install}
        >Repository-Zugriff auf GitHub einrichten<Icon
          name="external"
          size={14}
        /></button
      >
      <p class="field-help">
        Installiere die App auf deinem Konto oder deiner Organisation und wähle
        einzelne oder alle Repositories. Organisationen können eine Freigabe
        oder aktive SSO-Sitzung verlangen. Danach die Repository-Liste
        aktualisieren.
      </p>
    {/if}
  {/if}
  {#if message}<div class="alert warning" role="alert">{message}</div>{/if}
</div>

<style>
  .browser-auth {
    clear: both;
    margin: 1rem 0;
  }
  .browser-auth p {
    margin: 0.6rem 0;
    line-height: 1.6;
  }
  .browser-auth .field-help {
    font-size: 11px;
  }
  .browser-auth > .text-button {
    min-height: 28px;
    font-size: 11px;
  }
  h4 {
    margin: 0.6rem 0;
  }
  .browser-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .auth-code {
    margin-bottom: 1.25rem;
  }
  .auth-code code {
    user-select: all;
  }
</style>
