<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import RunLink from './RunLink.svelte';
  import { clockTime, runDuration, runMoment } from './format';
  import { statusLabel } from './runs';
  import { safeGitHubUrl } from './safeGitHubUrl';
  import type { NoticeTone } from './StatusBanners.svelte';
  import type { Run } from './types';

  let {
    run,
    expanded,
    repo,
    account,
    demo,
    native,
    now,
    onToggle,
    onNotice,
  }: {
    run: Run;
    expanded: boolean;
    /** Repository display name. */
    repo: string;
    /** Account display name; only read while expanded. */
    account: string;
    demo: boolean;
    native: boolean;
    /** Shared minute clock (ms) for relative times and running durations. */
    now: number;
    onToggle: () => void;
    /** Panel banner for link results: copied, or why opening/copying failed. */
    onNotice: (text: string, tone: NoticeTone) => void;
  } = $props();

  const linkError = (message: string) => onNotice(message, 'warning');
  const noLink = $derived(
    demo
      ? 'Demo-Runs haben keinen GitHub-Link'
      : 'Für diesen Run gibt es keinen gültigen GitHub-Link',
  );

  async function copyLink() {
    if (!runUrl) return;
    try {
      await navigator.clipboard.writeText(runUrl);
      onNotice('Link kopiert.', 'subtle');
    } catch {
      linkError(
        'Link konnte nicht kopiert werden. Öffne den Run auf GitHub und kopiere ihn dort.',
      );
    }
  }

  const icon: IconName = $derived(
    run.status === 'in_progress'
      ? 'activity'
      : run.status === 'waiting'
        ? 'pause'
        : run.status === 'queued'
          ? 'clock'
          : run.conclusion === 'success'
            ? 'check'
            : 'close',
  );
  const runUrl = $derived(safeGitHubUrl(run.htmlUrl));
  const moment = $derived(runMoment(run, now, demo));
</script>

<article class="run" class:expanded>
  <div class="run-head">
    <button
      class="run-button"
      aria-expanded={expanded}
      aria-label={`${run.name} #${run.id} · ${repo} · ${statusLabel(run)} · ${moment.spoken}`}
      onclick={() => onToggle()}
    >
      <span
        class="status-icon"
        class:running={run.status === 'in_progress'}
        class:queued={run.status === 'queued'}
        class:waiting={run.status === 'waiting'}
        class:success={run.conclusion === 'success'}
        class:failure={run.conclusion === 'failure'}
        ><Icon name={icon} size={16} /></span
      >
      <span class="run-main"
        ><span class="run-name"
          >{run.name}<span class="run-number">#{run.id}</span></span
        ><span class="run-repo">{repo}</span><span class="run-branch"
          ><Icon name="branch" size={11} /><span class="run-ref"
            >{run.branch}</span
          ><span class="meta-dot">·</span><span class="run-duration"
            >{runDuration(run, now, !demo)}</span
          ></span
        ></span
      >
      <span class="run-tail"
        ><span class="run-state"
          ><span
            class="status-label"
            class:running={run.status === 'in_progress'}
            class:failure={run.conclusion === 'failure'}
            >{statusLabel(run)}</span
          ><Icon name="chevron" size={14} /></span
        ><time class="run-time" datetime={moment.datetime} title={moment.title}
          >{moment.relative}</time
        ></span
      >
    </button>
    <!-- Siblings of the row button, so both stay reachable without expanding. -->
    <div class="run-actions">
      {#if runUrl}<RunLink
          url={runUrl}
          label={`${run.name} #${run.id} auf GitHub öffnen`}
          {native}
          onError={linkError}
          iconOnly
        />{:else}<button
          class="run-action"
          disabled
          aria-label={`${run.name} #${run.id} auf GitHub öffnen`}
          title={noLink}><Icon name="external" size={14} /></button
        >{/if}<button
        class="run-action"
        disabled={!runUrl}
        aria-label={`Link zu ${run.name} #${run.id} kopieren`}
        title={runUrl ? 'Link kopieren' : noLink}
        onclick={() => void copyLink()}
        ><svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          ><rect x="8.5" y="8.5" width="12" height="12" rx="2" /><path
            d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"
          /></svg
        ></button
      >
    </div>
  </div>
  {#if expanded}<div class="run-details">
      <div>
        <span>Konto</span><strong>{account}</strong>
      </div>
      <div>
        <span>Aktualisiert</span><strong
          >{clockTime(run.updatedAt)}{demo ? ' · Demo-Zeit' : ''}</strong
        >
      </div>
      <div>
        <span>Status</span><strong>{statusLabel(run)}</strong>
      </div>
      {#if runUrl}<RunLink
          url={runUrl}
          label="Auf GitHub ansehen"
          {native}
          onError={linkError}
        />{:else}<button class="detail-link" disabled title={noLink}
          >{demo
            ? 'GitHub-Link in Demo nicht verfügbar'
            : 'GitHub-Link nicht verfügbar'}<Icon
            name="external"
            size={13}
          /></button
        >{/if}
    </div>{/if}
</article>
