<script module lang="ts">
  export type NoticeTone = 'subtle' | 'warning' | 'danger';
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import type { Snapshot } from './types';
  import type { UpdateInfo } from './updates';

  let {
    update,
    demo,
    snapshot,
    error,
    notice,
    noticeTone,
    onShowUpdate,
    onDismissNotice,
  }: {
    update: UpdateInfo | null;
    demo: boolean;
    snapshot: Snapshot | null;
    error: string;
    notice: string;
    noticeTone: NoticeTone;
    onShowUpdate: () => void;
    onDismissNotice: () => void;
  } = $props();
</script>

{#if update && !demo}<div class="alert subtle notice-banner" role="status">
    <Icon name="refresh" size={16} /><span
      >RepoTray {update.version} verfügbar</span
    ><button class="text-button" onclick={() => onShowUpdate()}
      >Update ansehen</button
    >
  </div>{/if}
{#if snapshot?.stale || snapshot?.connectivity === 'forbidden'}<div
    class="alert warning"
    role="status"
  >
    <Icon name="warning" size={16} /><span
      >{snapshot.message ?? 'Demo-Status nicht verfügbar.'}</span
    >
  </div>{/if}
{#if error}<div class="alert danger" role="alert">
    <Icon name="warning" size={16} /><span>{error}</span>
  </div>{/if}
{#if notice}<div class={`alert ${noticeTone} notice-banner`} role="status">
    <Icon name={noticeTone === 'subtle' ? 'check' : 'warning'} size={16} /><span
      >{notice}</span
    ><button
      class="icon-button small"
      aria-label="Meldung schließen"
      onclick={() => onDismissNotice()}><Icon name="close" size={13} /></button
    >
  </div>{/if}
