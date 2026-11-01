<script lang="ts">
  import Icon from './Icon.svelte';
  import UncertainStartHelp from './UncertainStartHelp.svelte';
  import { favoriteNames, type StartGate } from './startReason';
  import type { Pin } from './types';

  let {
    pin,
    uncertain,
    repo,
    account,
    demo,
    gate,
    onLaunch,
    onConfigure,
    onRemove,
  }: {
    pin: Pin;
    /** The pin's target has a start with unknown outcome; quick start stays locked. */
    uncertain: boolean;
    /** Repository display name. */
    repo: string;
    /** Account display name. */
    account: string;
    demo: boolean;
    /** What this favorite's controls may do right now (`Starts.gate`). */
    gate: StartGate;
    onLaunch: () => void;
    onConfigure: () => void;
    onRemove: () => void;
  } = $props();
  const names = $derived(favoriteNames(pin.label));
</script>

<!-- `data-pin-*` lets focus move to a neighbour or a restored card. -->
<article class="pin-card" data-pin-id={pin.id}>
  <div class="pin-content">
    <div class="pin-title-line">
      <h3>{pin.label}</h3>
      {#if uncertain}<span class="pin-ref"
          ><Icon name="branch" size={11} />{pin.ref}</span
        >{/if}
    </div>
    <!-- eslint-disable svelte/no-useless-mustaches -- the literal keeps the leading space Svelte trims at the start of an element -->
    <p class="pin-repo">
      {repo}<span class="pin-account" title={`Konto ${account}`}
        >{' · '}{account}</span
      >
    </p>
    <!-- eslint-enable svelte/no-useless-mustaches -->
    <div class="pin-meta">
      {#if uncertain}<UncertainStartHelp
          id={`uncertain-help-${pin.id}`}
          quickStart={pin.quickStart}
          {demo}
        />
      {:else}<span class="pin-ref"
          ><Icon name="branch" size={11} />{pin.ref}</span
        ><span class="pin-mode" class:quick={pin.quickStart}
          >{pin.quickStart ? 'Schnellstart aktiv' : 'Mit Bestätigung'}</span
        >{/if}
    </div>
  </div>
  <div class="pin-actions">
    <button
      class="pin-start"
      onclick={() => onLaunch()}
      disabled={!gate.canStart}
      title={gate.reason ?? undefined}
      aria-label={pin.quickStart ? undefined : names.open}
      ><Icon name={pin.quickStart ? 'bolt' : 'play'} size={13} />{pin.quickStart
        ? 'Schnellstart'
        : 'Starten…'}</button
    >
    {#if pin.quickStart}<button
        class="icon-button pin-configure"
        aria-label={names.open}
        title={gate.openReason ?? 'Starten…'}
        onclick={() => onConfigure()}
        disabled={!gate.canOpen}><Icon name="settings" size={14} /></button
      >{/if}
    <button
      class="icon-button small delete-pin"
      data-pin-remove
      aria-label={names.remove}
      title="Favorit entfernen"
      onclick={() => onRemove()}
      disabled={!gate.canRemove}><Icon name="trash" size={14} /></button
    >
  </div>
</article>
