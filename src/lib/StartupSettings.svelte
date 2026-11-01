<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { call } from './ipc';
  import type { StartupStatus } from './types';

  let { native }: { native: boolean } = $props();
  let current = $state<StartupStatus | null>(null);
  let busy = $state(false);
  let error = $state('');
  let saved = $state(false);
  let disposed = false;
  const supported = $derived(native && current?.status !== 'unsupported');
  const editable = $derived(
    current?.status === 'enabled' || current?.status === 'disabled',
  );
  const statusText = $derived(
    !current
      ? 'Status wird gelesen …'
      : current.status === 'enabled'
        ? 'Aktiv · startet bei deiner nächsten Windows-Anmeldung im Tray.'
        : current.status === 'disabled'
          ? 'Aus · RepoTray startet nicht automatisch.'
          : current.status === 'disabledByWindows'
            ? 'In Windows deaktiviert. Aktiviere RepoTray unter Windows-Einstellungen → Apps → Autostart.'
            : current.status === 'unknownApproval'
              ? 'Windows-Freigabe unbekannt. Prüfe RepoTray unter Windows-Einstellungen → Apps → Autostart.'
              : current.status === 'conflict'
                ? 'Ein anderer Eintrag oder Installationspfad verwendet diesen Autostartnamen. Deaktiviere ihn in der ursprünglichen Installation. Es wird nichts überschrieben.'
                : 'Windows-Autostart ist nur unter Windows verfügbar.',
  );

  async function readStatus() {
    if (!native || busy || disposed) return;
    busy = true;
    error = '';
    saved = false;
    try {
      const result = await call('autostart_status');
      if (!disposed) current = result;
    } catch (cause) {
      if (!disposed) {
        current = null;
        error = String(cause);
      }
    } finally {
      if (!disposed) busy = false;
    }
  }

  async function change(enabled: boolean) {
    if (busy || !native || !current) return;
    busy = true;
    error = '';
    saved = false;
    try {
      const result = await call('set_autostart', { enabled });
      if (!disposed) {
        current = result;
        saved = result.status === (enabled ? 'enabled' : 'disabled');
      }
    } catch (cause) {
      // A failed write or readback is uncertain. Do not keep an optimistic state.
      if (!disposed) {
        current = null;
        error = String(cause);
      }
    } finally {
      if (!disposed) busy = false;
    }
  }

  async function openWindowsSettings() {
    try {
      await call('open_startup_settings');
    } catch (cause) {
      if (!disposed) error = String(cause);
    }
  }

  onMount(() => {
    void readStatus();
    return () => {
      disposed = true;
    };
  });
</script>

<svelte:window onfocus={() => void readStatus()} />

<section
  class="startup-panel"
  aria-labelledby="startup-heading"
  aria-busy={busy}
>
  <h3 id="startup-heading">Start & Tray</h3>
  {#if !native}
    <p class="field-help">
      Windows-Autostart lässt sich in der installierten Windows-App einstellen.
      Die Browser-Demo ändert keine Windows-Einstellungen.
    </p>
  {:else if !supported}
    <p class="field-help">{statusText}</p>
  {:else}
    <label class="startup-option">
      <input
        type="checkbox"
        checked={current?.status === 'enabled'}
        disabled={busy || !editable}
        aria-describedby="startup-description startup-status"
        onchange={(event) => {
          const enabled = event.currentTarget.checked;
          event.currentTarget.checked = current?.status === 'enabled';
          void change(enabled);
        }}
      />
      <span>
        <strong>Mit Windows starten</strong>
        <span id="startup-description">
          Nach deiner Anmeldung direkt im System-Tray, ohne das Fenster zu
          öffnen.
        </span>
      </span>
    </label>
    <p id="startup-status" class="startup-status" role="status">
      {error && !current ? 'Status unbekannt.' : statusText}
      {#if saved}<span class="startup-saved">Gespeichert.</span>{/if}
    </p>
    <div class="startup-actions">
      <button class="secondary-button" disabled={busy} onclick={readStatus}
        ><Icon name="refresh" size={14} />Status prüfen</button
      >
      {#if current?.status === 'disabledByWindows' || current?.status === 'unknownApproval'}
        <button
          class="secondary-button"
          disabled={busy}
          onclick={openWindowsSettings}>Windows-Autostart öffnen</button
        >
        {#if current.registered}<button
            class="text-button"
            disabled={busy}
            onclick={() => change(false)}>Autostarteintrag entfernen</button
          >{/if}
      {/if}
    </div>
    <p class="field-help startup-help">
      Die Änderung gilt sofort. Manuelles Öffnen zeigt weiterhin das Fenster.
      Beim Schließen bleibt RepoTray im Tray; „RepoTray beenden“ beendet die
      App.
    </p>
    {#if error}<div class="alert danger" role="alert">
        <Icon name="warning" size={16} /><span>{error}</span>
      </div>{/if}
  {/if}
</section>
