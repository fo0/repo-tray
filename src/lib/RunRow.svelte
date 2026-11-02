<script lang="ts">
  import Icon from './Icon.svelte';
  import RunLink, { copyLink } from './RunLink.svelte';
  import { clockTime, runDuration, runMoment } from './format';
  import {
    isActive,
    runLabel,
    runTone,
    shortRepo,
    statusLabel,
    TONE_ICON,
  } from './runs';
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
    /** Full repository name, `owner/name`; the row shows the name only. */
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

  // One status icon and colour per tone everywhere, as in „Läuft gerade“.
  const tone = $derived(runTone(run));
  const open = $derived(isActive(run));
  const runUrl = $derived(safeGitHubUrl(run.htmlUrl));
  const moment = $derived(runMoment(run, now, demo));
  const elapsed = $derived(runDuration(run, now, !demo));
</script>

<article class="run" class:expanded data-run={`${run.repoId}:${run.id}`}>
  <button
    class="run-button"
    aria-expanded={expanded}
    aria-label={`${runLabel(run, repo)} · ${statusLabel(run)} · ${moment.spoken}`}
    onclick={() => onToggle()}
  >
    <!-- A running run turns a spinner, or shows the still icon when reduced
         motion is asked for (02-activity.css picks one). -->
    <span class="status-tile" data-tone={tone}
      >{#if tone === 'run'}<Icon
          name="spinner"
          size={15}
          class="tile-spinner"
        />{/if}<Icon name={TONE_ICON[tone]} size={15} /></span
    >
    <!-- The repository leads, since every repository may name its workflow
         „Release“; workflow and run number open the meta line. -->
    <span class="run-body"
      ><span class="run-repo" title={repo}>{shortRepo(repo)}</span><span
        class="run-meta"
        ><span class="run-workflow" title={run.name}
          >{run.name}<span class="run-number">#{run.id}</span></span
        ><span class="branch-chip" title={run.branch}
          ><Icon name="branch" size={11} /><span>{run.branch}</span></span
        >{#if !open}<span class="run-took"
            ><span class="meta-dot" aria-hidden="true">·</span><span
              class="run-duration">{elapsed}</span
            ></span
          >{/if}</span
      ></span
    >
    <!-- Open runs count up since their start; completed ones say when. -->
    <span class="run-side"
      ><span class="run-status tone-dot" data-tone={tone}
        >{statusLabel(run)}</span
      ><time class="run-time" datetime={moment.datetime} title={moment.title}
        >{open ? `seit ${elapsed}` : moment.relative}</time
      ></span
    >
  </button>
  {#if expanded}<div class="run-details">
      <div class="run-fact">
        <span>Konto</span><strong>{account}</strong>
      </div>
      <div class="run-fact">
        <span>Aktualisiert</span><strong
          >{clockTime(run.updatedAt)}{demo ? ' · Demo-Zeit' : ''}</strong
        >
      </div>
      <div class="run-fact">
        <span>Status</span><strong>{statusLabel(run)}</strong>
      </div>
      <!-- The actions of a run appear with its details, never on the row. -->
      <div class="run-links">
        {#if runUrl}<RunLink
            url={runUrl}
            label="Auf GitHub öffnen"
            {native}
            onError={linkError}
            button
          />{:else}<button
            class="secondary-button compact"
            disabled
            title={noLink}
            ><Icon name="external" size={13} />Auf GitHub öffnen</button
          >{/if}<button
          class="secondary-button compact"
          disabled={!runUrl}
          title={runUrl ? undefined : noLink}
          onclick={() => void copy()}
          ><Icon name="copy" size={13} />Link kopieren</button
        >
        {#if !runUrl}<span class="run-link-note">{noLink}.</span>{/if}
      </div>
    </div>{/if}
</article>
