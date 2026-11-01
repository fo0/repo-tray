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
    >{refreshing
      ? 'Aktualisiert …'
      : updatedAt !== undefined
        ? `Stand ${clockTime(updatedAt)}`
        : canRefresh
          ? 'Erneut laden'
          : 'Lädt …'}<Icon name="refresh" size={11} /></button
  >
</footer>
