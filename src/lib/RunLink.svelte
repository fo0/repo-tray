<script module lang="ts">
  import { errorMessage } from './format';
  import { call } from './ipc';

  /**
   * Opens a checked run link: natively the shell opens the system browser
   * and the webview never navigates; the browser demo follows the link. A
   * repository page (`safeRepoUrl`) takes `open_repo` the same way.
   */
  export function openRunLink(
    event: MouseEvent,
    url: string,
    native: boolean,
    onError: (message: string) => void,
    command: 'open_run' | 'open_repo' = 'open_run',
  ) {
    if (!native) return;
    event.preventDefault();
    void call(command, { url }).catch((cause) => onError(errorMessage(cause)));
  }

  /**
   * A middle click takes the same way as a click: natively the webview would
   * otherwise open the `target=_blank` link itself.
   */
  export function openRunLinkAux(
    event: MouseEvent,
    url: string,
    native: boolean,
    onError: (message: string) => void,
  ) {
    if (event.button === 1) openRunLink(event, url, native, onError);
  }

  /** Copies a checked link and reports in the panel banner either way. */
  export async function copyLink(
    url: string,
    onNotice: (text: string, tone: 'subtle' | 'warning') => void,
    failure: string,
  ) {
    try {
      await navigator.clipboard.writeText(url);
      onNotice('Link kopiert.', 'subtle');
    } catch {
      onNotice(failure, 'warning');
    }
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    url,
    label,
    native,
    onError,
    button = false,
  }: {
    /** Already checked with safeGitHubUrl; the shell re-validates it. */
    url: string;
    /** Visible text and accessible name. */
    label: string;
    native: boolean;
    onError: (message: string) => void;
    /** An expanded run's action: drawn as a button with the icon first. */
    button?: boolean;
  } = $props();

  const open = (event: MouseEvent) => openRunLink(event, url, native, onError);
  const openAux = (event: MouseEvent) =>
    openRunLinkAux(event, url, native, onError);
</script>

{#if button}<a
    class="secondary-button compact"
    href={url}
    onclick={open}
    onauxclick={openAux}
    target="_blank"
    rel="noopener noreferrer"><Icon name="external" size={13} />{label}</a
  >{:else}<a
    class="detail-link"
    href={url}
    onclick={open}
    onauxclick={openAux}
    target="_blank"
    rel="noopener noreferrer">{label}<Icon name="external" size={13} /></a
  >{/if}
