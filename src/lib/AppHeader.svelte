<script lang="ts">
  import Icon from './Icon.svelte';
  import type { Snapshot } from './types';

  let {
    native,
    demo,
    connectivity,
    accountCount,
    demoAccountConnected,
  }: {
    native: boolean;
    demo: boolean;
    /** Undefined while the first snapshot loads. */
    connectivity: Snapshot['connectivity'] | undefined;
    accountCount: number;
    demoAccountConnected: boolean;
  } = $props();
</script>

<header class="app-header" data-tauri-drag-region={native ? true : undefined}>
  <div class="brand">
    <span class="brand-icon"><Icon name="tray" size={18} /></span>
    <h1>RepoTray<span class="brand-period">.</span></h1>
  </div>
  <div
    class="connection"
    role="status"
    aria-label="Verbindungsstatus"
    title={demo
      ? 'Demo-Modus: keine echte GitHub-Verbindung. Alle Daten und Starts sind simuliert.'
      : 'GitHub-Verbindung · Token im Betriebssystem-Tresor'}
  >
    <span
      class="connection-dot"
      class:offline={connectivity === 'offline'}
      class:forbidden={connectivity === 'forbidden'}
    ></span>
    <span class="connection-copy"
      ><span class="demo-tag">{demo ? 'Demo' : 'GitHub'}</span><span
        aria-hidden="true">·</span
      ><span
        >{connectivity === 'offline'
          ? 'Offline'
          : connectivity === 'forbidden'
            ? 'Kein Zugriff'
            : !demo && accountCount
              ? 'Verbunden'
              : demoAccountConnected
                ? 'demo-dev · simuliert'
                : 'Nicht verbunden'}</span
      ></span
    >
  </div>
</header>
