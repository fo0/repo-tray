<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import Icon from './Icon.svelte';
  import {
    releaseDate,
    type UpdateInfo,
    type UpdatePhase,
    type UpdateProgress,
  } from './updates';

  let {
    currentVersion,
    native,
    info,
    phase,
    progress,
    error,
    checkedAt,
    onCheck,
    onDownload,
    onInstall,
  }: {
    currentVersion: string;
    native: boolean;
    info: UpdateInfo | null;
    phase: UpdatePhase;
    progress: UpdateProgress;
    error: string;
    checkedAt: string;
    onCheck: () => void;
    onDownload: () => void;
    onInstall: () => void;
  } = $props();
  const busy = $derived(
    ['checking', 'downloading', 'verifying', 'installing'].includes(phase),
  );
  const percent = $derived(
    progress.total
      ? Math.min(100, Math.floor((progress.downloaded / progress.total) * 100))
      : undefined,
  );
  // Unsigned builds only point to the release page; nothing is downloaded here.
  const notify = $derived(info?.mode === 'notify');
  const published = $derived(info ? releaseDate(info.date) : '');
  let opening = $state(false);
  let openError = $state('');
  function size(bytes: number) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  async function openReleasePage() {
    if (!info || opening) return;
    opening = true;
    openError = '';
    try {
      // Rust validates the version and opens only its GitHub tag page.
      await invoke('open_release_page', { version: info.version });
    } catch (cause) {
      openError =
        typeof cause === 'string'
          ? cause
          : 'Die Release-Seite konnte nicht geöffnet werden.';
    } finally {
      opening = false;
    }
  }
</script>

<section class="update-panel" aria-labelledby="updates-heading">
  <div class="update-heading">
    <span class="update-symbol"><Icon name="refresh" size={23} /></span>
    <div>
      <h3 id="updates-heading">RepoTray aktuell halten</h3>
      <p>Installiert · Version {currentVersion}</p>
    </div>
    <span class="version-badge">Stable</span>
  </div>
  <p class="update-description">
    RepoTray sucht regelmäßig nach neuen Versionen. Deine Konten, Repositories
    und Favoriten bleiben bei einem Update erhalten.
  </p>
  {#if !native}
    <p class="field-help">Die Browser-Demo installiert keine App-Updates.</p>
  {:else}
    <div class="update-check-row">
      <button
        class="secondary-button"
        disabled={busy || phase === 'ready'}
        onclick={onCheck}
      >
        <Icon name="refresh" size={14} />{phase === 'checking'
          ? 'Prüft …'
          : 'Auf Updates prüfen'}
      </button>
      <span class="field-help"
        >{checkedAt
          ? `Zuletzt geprüft · ${checkedAt}`
          : 'Kein GitHub-Login nötig'}</span
      >
    </div>
    {#if phase === 'current'}
      <p class="update-current" role="status">
        <Icon name="check" size={16} />Du verwendest die aktuelle Version.
      </p>
    {/if}
    {#if info}
      <div class="update-release">
        <div class="update-release-heading">
          <strong>Version {info.version}</strong><span
            >{phase === 'ready'
              ? 'Bereit zur Installation'
              : 'Neue Version verfügbar'}{published
              ? ` · veröffentlicht am ${published}`
              : ''}</span
          >
        </div>
        {#if notify}
          <p class="update-current" role="status">
            Version {info.version} ist verfügbar.
          </p>
        {:else}
          <ol class="update-steps" aria-label="Update-Ablauf">
            <li
              class:done={[
                'downloading',
                'verifying',
                'ready',
                'installing',
              ].includes(phase)}
            >
              1 · Verfügbar
            </li>
            <li class:done={['ready', 'installing'].includes(phase)}>
              2 · Laden & prüfen
            </li>
            <li class:done={phase === 'installing'}>3 · Neu starten</li>
          </ol>
        {/if}
        <details class="update-changelog" open>
          <summary>Was ist neu?</summary>
          <p>
            {info.notes.trim() ||
              'Für diese Version wurden keine Änderungsnotizen hinterlegt.'}
          </p>
        </details>
        {#if notify}
          <p class="field-help">
            Updates werden in dieser Version manuell installiert: Lade den
            Installer auf der Release-Seite herunter und starte ihn. Deine
            Einstellungen bleiben dabei erhalten.
          </p>
          <button
            class="primary-button"
            disabled={opening}
            onclick={openReleasePage}
            ><Icon name="external" size={14} />Release-Seite öffnen</button
          >
          {#if openError}<div class="alert danger" role="alert">
              <Icon name="warning" size={16} /><span>{openError}</span>
            </div>{/if}
        {:else if phase === 'downloading' || phase === 'verifying'}
          <div class="update-progress" role="status">
            <label for="update-download"
              >{phase === 'verifying'
                ? 'Download abgeschlossen · Signatur wird geprüft …'
                : `Wird heruntergeladen · ${size(progress.downloaded)}${progress.total ? ` / ${size(progress.total)}` : ''}`}</label
            >
            <progress id="update-download" max="100" value={percent}></progress>
          </div>
        {:else if phase === 'ready' || phase === 'installing'}
          <p class="update-current" role="status">
            <Icon name="check" size={16} />Download geprüft. Bereit, wenn du es
            bist.
          </p>
          <p class="field-help">
            RepoTray wird kurz geschlossen, aktualisiert und anschließend wieder
            gestartet. War die App per Autostart gestartet, bleibt sie danach im
            Tray. Eine manuelle Deinstallation ist nicht nötig.
          </p>
          <button class="primary-button" disabled={busy} onclick={onInstall}
            >{phase === 'installing'
              ? 'Installation wird gestartet …'
              : 'Installieren und neu starten'}</button
          >
        {:else}
          <button class="primary-button" disabled={busy} onclick={onDownload}
            >Update herunterladen</button
          >
          <p class="field-help">
            Die Installation startet erst nach deiner Bestätigung.
          </p>
        {/if}
      </div>
    {/if}
    {#if error}<div class="alert danger" role="alert">
        <Icon name="warning" size={16} /><span>{error}</span>
      </div>{/if}
  {/if}
</section>
