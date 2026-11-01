<script lang="ts">
  import Icon from './Icon.svelte';
  import { fullRepo } from './model';
  import type { Repo } from './types';

  let {
    repo,
    meta,
    inTray,
    busy,
    disabled = false,
    onToggle,
  }: {
    repo: Repo;
    /** The line under the name, e.g. the access level. */
    meta: string;
    /** In the tray, or about to be while the change is sent. */
    inTray: boolean;
    /** The change is not confirmed yet. */
    busy: boolean;
    /** Another settings change runs meanwhile. */
    disabled?: boolean;
    onToggle: () => void;
  } = $props();

  const label = $derived(inTray ? 'Im Tray' : 'Hinzufügen');
</script>

<!-- The visible text changes with the state, so it is no aria-pressed toggle
     (whose name must stay put): the name starts with that text (WCAG 2.5.3,
     label in name) and adds the repository; the title says what a press does. -->
<li class="pick" class:in={inTray} data-pick-id={repo.id}>
  <span class="pick-copy">
    <span class="pick-name" title={fullRepo(repo)}
      ><span class="pick-owner">{repo.owner}/</span><span>{repo.name}</span
      ></span
    >
    <small>{meta}</small>
  </span>
  <button
    class="pick-toggle"
    class:added={inTray}
    aria-label={`${label}: ${fullRepo(repo)}`}
    aria-busy={busy || undefined}
    title={busy
      ? 'Wird übernommen …'
      : inTray
        ? 'Aus dem Tray entfernen'
        : 'Zum Tray hinzufügen'}
    {disabled}
    onclick={() => onToggle()}
    ><span class="pick-icon" class:spinning={busy}
      ><Icon
        name={busy ? 'refresh' : inTray ? 'check' : 'plus'}
        size={13}
      /></span
    >{label}</button
  >
</li>
