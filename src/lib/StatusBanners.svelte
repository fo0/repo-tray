<script module lang="ts">
  export type NoticeTone = 'subtle' | 'warning' | 'danger';
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import NoticeBanner from './NoticeBanner.svelte';
  import type { Notice } from './notices.svelte';
  import type { Snapshot } from './types';
  import type { UpdateInfo } from './updates';

  let {
    update,
    demo,
    snapshot,
    error,
    notices,
    showsAccount,
    onShowUpdate,
    onShowRun,
    onDismissNotice,
  }: {
    update: UpdateInfo | null;
    demo: boolean;
    snapshot: Snapshot | null;
    error: string;
    /** General notice and per-target start results, oldest first. */
    notices: Notice[];
    /** Whether a run of this account is in the activity list right now. */
    showsAccount: (accountId: string) => boolean;
    onShowUpdate: () => void;
    onShowRun: (runId: number) => void;
    onDismissNotice: (id: number) => void;
  } = $props();
</script>

{#if update && !demo}<div class="alert subtle notice-banner" role="status">
    <Icon name="refresh" size={16} /><span
      >RepoTray {update.version} verfügbar</span
    ><button class="text-button" onclick={() => onShowUpdate()}
      >Update ansehen</button
    >
  </div>{/if}
{#if snapshot?.stale || snapshot?.connectivity === 'forbidden' || (!demo && snapshot?.message && snapshot.accounts.length > 0)}<div
    class="alert warning"
    role="status"
  >
    <Icon name="warning" size={16} /><span
      >{snapshot.message ??
        (demo
          ? 'Demo-Status nicht verfügbar.'
          : 'GitHub-Daten sind nicht aktuell. Klicke auf Aktualisieren.')}</span
    >
  </div>{/if}
{#if error}<div class="alert danger" role="alert">
    <Icon name="warning" size={16} /><span>{error}</span>
  </div>{/if}
{#each notices as notice (notice.id)}
  {@const runId =
    notice.runId && (!notice.accountId || showsAccount(notice.accountId))
      ? notice.runId
      : undefined}
  <NoticeBanner
    text={notice.text}
    tone={notice.tone}
    actionLabel={notice.action?.label ??
      (runId ? 'In Aktivität anzeigen' : undefined)}
    onAction={notice.action?.run ??
      (runId ? () => onShowRun(runId) : undefined)}
    navigates={!notice.action}
    timeout={notice.timeout}
    onDismiss={() => onDismissNotice(notice.id)}
  />
{/each}
