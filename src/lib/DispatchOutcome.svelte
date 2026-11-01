<script lang="ts">
  import Icon from './Icon.svelte';
  import RunLink from './RunLink.svelte';
  import { safeGitHubUrl } from './model';
  import type { DispatchOutcome } from './types';

  let {
    outcome,
    error,
    notice,
    noticeTone,
    uncertain,
    demo,
    native,
    checking,
    onCheckStatus,
    onShowRun,
    onLinkError,
  }: {
    /** This dialog's start result, if it has one. */
    outcome: DispatchOutcome | null;
    error: string;
    notice: string;
    noticeTone: 'subtle' | 'warning';
    /** The target is quarantined by an earlier start with unknown outcome. */
    uncertain: boolean;
    demo: boolean;
    native: boolean;
    /** A status refresh is running. */
    checking: boolean;
    onCheckStatus: () => void;
    onShowRun: (runId: number) => void;
    onLinkError: (message: string) => void;
  } = $props();
  let box = $state<HTMLElement>();
  let errorBox = $state<HTMLElement>();
  const runUrl = $derived(safeGitHubUrl(outcome?.htmlUrl ?? ''));

  /** Brings a fresh result or error into view and moves focus to it. */
  export function focus() {
    const target = box ?? errorBox;
    target?.scrollIntoView({ block: 'nearest' });
    target?.focus({ preventScroll: true });
  }
</script>

{#if error}<div
    class="alert danger"
    role="alert"
    tabindex="-1"
    bind:this={errorBox}
  >
    <Icon name="warning" size={16} /><span>{error}</span>
  </div>{/if}
{#if notice}<div class={`alert ${noticeTone}`} role="status">
    <Icon
      name={noticeTone === 'warning' ? 'warning' : 'check'}
      size={16}
    /><span>{notice}</span>
  </div>{/if}

{#snippet checkStatus()}<button
    type="button"
    class="text-button"
    onclick={() => onCheckStatus()}
    disabled={checking}>Status prüfen<Icon name="refresh" size={12} /></button
  >{/snippet}

{#if outcome}<div
    class="outcome"
    class:accepted={outcome.state === 'accepted'}
    class:uncertain={outcome.state === 'uncertain'}
    class:rejected={outcome.state === 'rejected'}
    role="status"
    tabindex="-1"
    bind:this={box}
  >
    <Icon name={outcome.state === 'accepted' ? 'check' : 'warning'} size={18} />
    <div>
      <strong
        >{outcome.state === 'accepted'
          ? demo
            ? 'Simulierter Start angenommen'
            : 'GitHub hat den Start angenommen'
          : outcome.state === 'uncertain'
            ? 'Startstatus ungeklärt'
            : 'Start abgelehnt'}</strong
      >
      <p>{outcome.message}</p>
      {#if outcome.state === 'accepted' && outcome.runId}
        {@const runId = outcome.runId}
        {#if runUrl}<RunLink
            url={runUrl}
            label={`Run #${runId} auf GitHub`}
            {native}
            onError={onLinkError}
          />{/if}
        <button
          type="button"
          class="text-button"
          onclick={() => onShowRun(runId)}
          >In Aktivität anzeigen<Icon name="arrow" size={13} /></button
        >
      {/if}
      {#if outcome.state === 'uncertain'}{@render checkStatus()}{/if}
    </div>
  </div>
{:else if uncertain}<div class="outcome uncertain" role="status">
    <Icon name="warning" size={18} />
    <div>
      <strong>Startstatus ungeklärt</strong>
      <p>
        Für dieses Ziel fehlt die Startbestätigung. Ein erneuter Start bleibt
        gesperrt. Prüfe zuerst den Status.
      </p>
      {@render checkStatus()}
    </div>
  </div>{/if}
