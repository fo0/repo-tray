<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import Icon from './Icon.svelte';
  import { errorMessage } from './format';

  let {
    url,
    label,
    native,
    onError,
    iconOnly = false,
  }: {
    /** Already checked with safeGitHubUrl; the shell re-validates it. */
    url: string;
    /** Visible text, or the accessible name of the icon-only variant. */
    label: string;
    native: boolean;
    onError: (message: string) => void;
    /** Compact row action: icon only, `label` becomes its accessible name. */
    iconOnly?: boolean;
  } = $props();

  function open(event: MouseEvent) {
    if (!native) return;
    // The webview never navigates; the shell opens the system browser.
    event.preventDefault();
    void invoke('open_run', { url }).catch((cause) =>
      onError(errorMessage(cause)),
    );
  }
</script>

{#if iconOnly}<a
    class="run-action"
    href={url}
    onclick={open}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={label}
    title="Auf GitHub öffnen"><Icon name="external" size={14} /></a
  >{:else}<a
    class="detail-link"
    href={url}
    onclick={open}
    target="_blank"
    rel="noopener noreferrer">{label}<Icon name="external" size={13} /></a
  >{/if}
