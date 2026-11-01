<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import RunLink from './RunLink.svelte';
  import { clockTime } from './format';
  import { duration, safeGitHubUrl, statusLabel } from './model';
  import type { Run } from './types';

  let {
    run,
    expanded,
    repo,
    account,
    demo,
    native,
    onToggle,
    onLinkError,
  }: {
    run: Run;
    expanded: boolean;
    /** Repository display name. */
    repo: string;
    /** Account display name; only read while expanded. */
    account: string;
    demo: boolean;
    native: boolean;
    onToggle: () => void;
    onLinkError: (message: string) => void;
  } = $props();

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
</script>

<article class="run" class:expanded>
  <button
    class="run-button"
    aria-expanded={expanded}
    aria-label={`${run.name} · ${repo} · ${statusLabel(run)}`}
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
        ><Icon name="branch" size={11} />{run.branch}<span class="meta-dot"
          >·</span
        ><span>{duration(run)}</span></span
      ></span
    >
    <span class="run-tail"
      ><span
        class="status-label"
        class:running={run.status === 'in_progress'}
        class:failure={run.conclusion === 'failure'}>{statusLabel(run)}</span
      ><Icon name="chevron" size={14} /></span
    >
  </button>
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
          onError={onLinkError}
        />{:else}<button
          class="detail-link"
          disabled
          title="Demo-Runs haben keinen GitHub-Link"
          >GitHub-Link in Demo nicht verfügbar<Icon
            name="external"
            size={13}
          /></button
        >{/if}
    </div>{/if}
</article>
