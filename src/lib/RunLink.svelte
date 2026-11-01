<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import Icon from './Icon.svelte';
  import { errorMessage } from './format';

  let {
    url,
    label,
    native,
    onError,
  }: {
    /** Already checked with safeGitHubUrl; the shell re-validates it. */
    url: string;
    label: string;
    native: boolean;
    onError: (message: string) => void;
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

<a
  class="detail-link"
  href={url}
  onclick={open}
  target="_blank"
  rel="noopener noreferrer">{label}<Icon name="external" size={13} /></a
>
