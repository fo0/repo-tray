<script lang="ts">
  import Icon from './Icon.svelte';
  import { clockTime } from './format';
  import { m } from './i18n/index.svelte';
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
  const text = $derived(m().shell.footer);
  const stamp = $derived(
    updatedAt !== undefined ? text.stamp(clockTime(updatedAt)) : '',
  );
  const status = $derived(
    connectivity === 'offline'
      ? text.offline
      : connectivity === 'forbidden'
        ? text.forbidden
        : !demo && accountCount
          ? text.connected
          : demoAccountConnected
            ? text.demoSimulated
            : text.disconnected,
  );
</script>

<footer class="app-footer">
  <div
    class="connection"
    role="status"
    aria-label={text.connection}
    title={demo ? text.demoTitle : text.liveTitle}
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
      >{demo ? text.staleDemo : text.stale}</span
    >{/if}
  <button
    onclick={() => !refreshing && onRefresh()}
    disabled={!canRefresh}
    aria-disabled={refreshing ? 'true' : undefined}
    title={demo ? text.refreshDemo : text.refreshLive}
    aria-label={!refreshing && stamp ? text.refreshStamp(stamp) : undefined}
    >{refreshing
      ? text.refreshing
      : stamp
        ? stamp
        : canRefresh
          ? text.reload
          : text.loading}<Icon name="refresh" size={12} /></button
  >
</footer>
