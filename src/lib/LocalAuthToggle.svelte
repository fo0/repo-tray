<script lang="ts">
  import Icon from './Icon.svelte';
  import { plural } from './format';

  let {
    expanded,
    disabled,
    connected,
    onToggle,
  }: {
    expanded: boolean;
    disabled: boolean;
    /** Number of gh accounts already connected in RepoTray. */
    connected: number;
    onToggle: () => void;
  } = $props();
</script>

<button
  type="button"
  class="secondary-button full-width local-method-toggle"
  aria-label="Bestehende Anmeldung auf diesem PC verwenden"
  aria-describedby="local-auth-method-hint"
  aria-expanded={expanded}
  aria-controls="local-auth-options"
  {disabled}
  onclick={onToggle}
>
  <Icon name="computer" size={21} />
  <span class="local-method-copy">
    <strong>Bestehende Anmeldung auf diesem PC verwenden</strong>
    <small id="local-auth-method-hint"
      >{connected
        ? `${plural(connected, 'gh-Konto', 'gh-Konten')} in RepoTray verbunden`
        : 'Noch kein gh-Konto in RepoTray verbunden'}</small
    >
  </span>
  <span class="local-method-chevron" class:open={expanded}
    ><Icon name="down" size={16} /></span
  >
</button>

<style>
  /* Both classes: must outrank the global `.token-path .secondary-button`. */
  .local-method-toggle.secondary-button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 54px;
    margin-top: 0;
    padding: 10px 12px;
    border: 1px solid var(--border-strong);
    background: var(--raised);
    color: var(--text);
    text-align: left;
    white-space: normal;
    justify-content: flex-start;
  }
  .local-method-toggle > :global(svg) {
    flex-shrink: 0;
  }
  .local-method-toggle:hover:not(:disabled) {
    border-color: var(--accent-line);
    background: var(--hover);
  }
  .local-method-toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .local-method-copy {
    min-width: 0;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
  }
  .local-method-copy strong {
    font-size: var(--font-size-meta);
    font-weight: 600;
    line-height: 1.45;
  }
  .local-method-copy small {
    color: var(--text-2);
    font-size: var(--font-size-meta);
    line-height: 1.4;
  }
  .local-method-chevron {
    display: flex;
    flex-shrink: 0;
  }
  .local-method-chevron.open {
    transform: rotate(180deg);
  }
</style>
