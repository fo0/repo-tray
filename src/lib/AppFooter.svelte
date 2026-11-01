<script lang="ts">
  import Icon from './Icon.svelte';
  import { clockTime } from './format';

  let {
    stale,
    demo,
    updatedAt,
    refreshing,
    canRefresh,
    onRefresh,
  }: {
    stale: boolean;
    demo: boolean;
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
</script>

<footer class="app-footer">
  <span
    ><span class="footer-dot"></span>{stale
      ? demo
        ? 'Veralteter Demo-Stand'
        : 'Veralteter Stand'
      : demo
        ? 'Alles lokal. Alles im Blick.'
        : 'GitHub Actions im Blick.'}</span
  ><button
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
          : 'Lädt …'}<Icon name="refresh" size={11} /></button
  >
</footer>
