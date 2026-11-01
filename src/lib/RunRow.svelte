<script lang="ts">
  import Icon from './Icon.svelte';
  import RunLink, { copyLink } from './RunLink.svelte';
  import { clockTime, runDuration, runMoment } from './format';
  import { runTone, statusLabel, TONE_ICON } from './runs';
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

  const copy = () =>
    runUrl &&
    copyLink(
      runUrl,
      onNotice,
      'Link konnte nicht kopiert werden. Öffne den Run auf GitHub und kopiere ihn dort.',
    );

  // One status icon per tone everywhere: the same mapping as „Läuft gerade“.
  const icon = $derived(TONE_ICON[runTone(run)]);
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
        onclick={() => void copy()}><Icon name="copy" size={14} /></button
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
