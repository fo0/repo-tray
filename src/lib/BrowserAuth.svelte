<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { ipcErrorMessage } from './format';
  import { intlLocale, m } from './i18n/index.svelte';
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
      message = ipcErrorMessage(cause, m().accounts.browser.pollFailed);
      setBusy(false);
      void call('cancel_connect').catch(() => {});
    }
  }
  async function openBrowser() {
    try {
      await call('open_browser_auth', { flowId });
    } catch (cause) {
      if (active)
        message = ipcErrorMessage(cause, m().accounts.browser.openFailed);
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
      message = ipcErrorMessage(cause, m().accounts.browser.startFailed);
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
      if (active) message = m().accounts.browser.cancelUnconfirmed;
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
      if (active) message = m().accounts.browser.copyFailed;
    }
  }
  async function install() {
    try {
      await call('open_browser_installation');
    } catch (cause) {
      if (active)
        message = ipcErrorMessage(cause, m().accounts.browser.githubFailed);
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
    <p role="status">{m().accounts.browser.preparing}</p>
    <button type="button" class="secondary-button" onclick={cancel}
      >{m().accounts.browser.cancel}</button
    >
  {:else if status.state === 'awaitingAuthorization'}
    <h4>{m().accounts.browser.confirmHeading}</h4>
    <p>
      {m().accounts.browser.enterCodeBefore}<strong
        >github.com/login/device</strong
      >{m().accounts.browser.enterCodeAfter}
    </p>
    <div class="auth-code">
      <span>{m().accounts.browser.code}</span><code>{status.userCode}</code>
      <button type="button" class="text-button" onclick={copyCode}
        >{copied
          ? m().accounts.browser.copied
          : m().accounts.browser.copy}</button
      >
      <small
        >{m().accounts.browser.validUntil(
          new Date((status.expiresAt ?? 0) * 1000).toLocaleTimeString(
            intlLocale(),
            { hour: '2-digit', minute: '2-digit' },
          ),
        )}</small
      >
    </div>
    <p class="field-help">{m().accounts.browser.waiting}</p>
    <div class="browser-actions">
      <button type="button" class="secondary-button" onclick={openBrowser}
        >{m().accounts.browser.reopen}<Icon name="external" size={14} /></button
      >
      <button type="button" class="text-button" onclick={cancel}
        >{m().accounts.browser.cancel}</button
      >
    </div>
  {:else}
    {#if status.state === 'cancelled'}<p role="status">
        {m().accounts.browser.cancelled}
      </p>
    {:else if status.state === 'expired'}<p role="status">
        {m().accounts.browser.expired}
      </p>
    {:else if status.state === 'denied'}<p role="status">
        {m().accounts.browser.denied}
      </p>{/if}
    <button
      type="button"
      class="primary-button full-width"
      disabled={disabled || busy || !configured || !loaded}
      onclick={begin}
    >
      <Icon name="github" size={16} />{!loaded
        ? m().accounts.browser.loading
        : !configured
          ? m().accounts.browser.notConfiguredButton
          : status.state === 'idle'
            ? m().accounts.browser.signIn
            : m().accounts.browser.signInAgain}
    </button>
    <p class="field-help">
      {configured
        ? m().accounts.browser.opensBrowser
        : m().accounts.browser.notConfigured}
    </p>
    {#if configured}
      <button
        type="button"
        class="text-button"
        disabled={busy || disabled}
        onclick={install}
        >{m().accounts.browser.install}<Icon
          name="external"
          size={14}
        /></button
      >
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
    font-size: var(--font-size-meta);
  }
  .browser-auth > .text-button {
    min-height: 28px;
    font-size: var(--font-size-meta);
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
