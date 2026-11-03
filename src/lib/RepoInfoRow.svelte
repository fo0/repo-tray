<script lang="ts">
  import Icon from './Icon.svelte';
  import { openRunLink } from './RunLink.svelte';
  import type { NoticeTone } from './StatusBanners.svelte';
  import { minuteClock } from './clock';
  import { dateTime, relativeTime } from './format';
  import { fullRepo } from './model';
  import { safeRepoUrl } from './safeGitHubUrl';
  import type { Repo } from './types';

  let {
    repo,
    native,
    demo,
    onNotice,
  }: {
    repo: Repo;
    native: boolean;
    demo: boolean;
    /** Panel banner for link results. */
    onNotice: (text: string, tone: NoticeTone) => void;
  } = $props();

  const name = $derived(fullRepo(repo));
  // Demo repositories are fictional: no link to a real page (as RepoMenu).
  const url = $derived(demo ? null : safeRepoUrl(repo.owner, repo.name));
  const linkError = (message: string) => onNotice(message, 'warning');
  const open = (event: MouseEvent) =>
    url && openRunLink(event, url, native, linkError, 'open_repo');
</script>

<!-- The expanded repository's first line: default branch, last push and its
     page on GitHub; quieter than the workflow rows under it. The access tag
     stays in the row's head only, so it is never shown twice. -->
<div class="repository-info">
  <span class="sr-only">Standardbranch</span><span
    class="branch-chip"
    title={`Standardbranch: ${repo.defaultBranch}`}
    ><Icon name="branch" size={11} /><span>{repo.defaultBranch}</span></span
  >{#if repo.pushedAt}<time
      class="repository-when"
      datetime={repo.pushedAt}
      title={`Letzter Push: ${dateTime(repo.pushedAt)}${demo ? ' · Demo-Zeit' : ''}`}
      >Push {relativeTime(repo.pushedAt, $minuteClock)}</time
    >{/if}{#if url}<a
      class="repository-github"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${name} auf GitHub öffnen`}
      title={url}
      onclick={open}
      onauxclick={(event) => {
        if (event.button === 1) open(event);
      }}><Icon name="external" size={12} />GitHub</a
    >{:else}<button
      type="button"
      class="repository-github"
      aria-label={`${name} auf GitHub öffnen`}
      title={demo
        ? 'Demo-Repositories haben keinen GitHub-Link'
        : 'Für dieses Repository gibt es keinen gültigen GitHub-Link'}
      disabled><Icon name="external" size={12} />GitHub</button
    >{/if}
</div>
