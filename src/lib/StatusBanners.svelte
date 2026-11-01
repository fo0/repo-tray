<script module lang="ts">
  export type NoticeTone = 'subtle' | 'warning' | 'danger';
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import NoticeBanner from './NoticeBanner.svelte';
  import { focusAfterNotice, neighbourNotice } from './focus';
  import type { Notice } from './notices.svelte';
  import type { Snapshot } from './types';
  import type { UpdateInfo } from './types';

  let {
    update,
    demo,
    snapshot,
    error,
    notices,
    showsAccount,
    paused = false,
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
    /** Whether a run of this account is in the Verlauf right now. */
    showsAccount: (accountId: string) => boolean;
    /** A dialog hides the notices: none closes on its own meanwhile. */
    paused?: boolean;
    onShowUpdate: () => void;
    onShowRun: (runId: number) => void;
    onDismissNotice: (id: number) => void;
  } = $props();
  /** The version whose banner was closed this session; a newer one shows again. */
  let dismissedUpdate = $state('');
  /** Like a notice: focus moves on first, so closing never drops it to <body>. */
  function dismissUpdate(event: MouseEvent, version: string) {
    const banner = (event.currentTarget as HTMLElement).closest<HTMLElement>(
      '.notice-banner',
    );
    if (banner?.contains(document.activeElement))
      focusAfterNotice(neighbourNotice(banner));
    dismissedUpdate = version;
  }
</script>

{#if update && !demo && dismissedUpdate !== update.version}<div
    class="alert subtle notice-banner"
    role="status"
  >
    <Icon name="refresh" size={16} /><span
      >Update {update.version} verfügbar</span
    ><button class="text-button" onclick={() => onShowUpdate()}>Ansehen</button
    ><button
      class="icon-button small"
      aria-label="Hinweis schließen"
      onclick={(event) => dismissUpdate(event, update.version)}
      ><Icon name="close" size={13} /></button
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
      (runId ? 'Im Verlauf anzeigen' : undefined)}
    onAction={notice.action?.run ??
      (runId ? () => onShowRun(runId) : undefined)}
    navigates={!notice.action}
    timeout={notice.timeout}
    {paused}
    onDismiss={() => onDismissNotice(notice.id)}
  />
{/each}
