<script lang="ts">
  import Icon from './Icon.svelte';
  import { clockTime } from './format';
  import type { Snapshot } from './types';

  let {
    stale,
    demo,
    connectivity,
    accountCount,
    demoAccountConnected,
    updatedAt,
    refreshing,
    canRefresh,
    onRefresh,
  }: {
    stale: boolean;
    demo: boolean;
    /** Undefined while the first snapshot loads. */
    connectivity: Snapshot['connectivity'] | undefined;
    accountCount: number;
    /** The browser demo simulated a connection for demo-dev. */
    demoAccountConnected: boolean;
    /** Snapshot timestamp; undefined while the first snapshot loads. */
    updatedAt: string | undefined;
    refreshing: boolean;
    /** False while the first snapshot loads; true again after a load error. */
    canRefresh: boolean;
    onRefresh: () => void;
  } = $props();
  const stamp = $derived(
    updatedAt !== undefined ? `Stand ${clockTime(updatedAt)}` : '',
  );
  const status = $derived(
    connectivity === 'offline'
      ? 'Offline'
      : connectivity === 'forbidden'
        ? 'Kein Zugriff'
        : !demo && accountCount
          ? 'Verbunden'
          : demoAccountConnected
            ? 'demo-dev · simuliert'
            : 'Nicht verbunden',
  );
</script>

<footer class="app-footer">
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
      ><span>{status}</span></span
    >
  </div>
  {#if stale}<span class="footer-stale"
      >{demo ? 'Veralteter Demo-Stand' : 'Veralteter Stand'}</span
    >{/if}
  <button
    onclick={() => onRefresh()}
    disabled={refreshing || !canRefresh}
    title={demo ? 'Demo-Status aktualisieren' : 'GitHub-Status aktualisieren'}
    aria-label={!refreshing && stamp ? `Aktualisieren · ${stamp}` : undefined}
    >{refreshing
      ? 'Aktualisiert …'
      : stamp
        ? stamp
        : canRefresh
          ? 'Erneut laden'
          : 'Lädt …'}<Icon name="refresh" size={12} /></button
  >
</footer>
