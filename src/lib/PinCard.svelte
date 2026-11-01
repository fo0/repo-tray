<script lang="ts">
  import Icon from './Icon.svelte';
  import UncertainStartHelp from './UncertainStartHelp.svelte';
  import type { Pin } from './types';

  let {
    pin,
    uncertain,
    repo,
    account,
    demo,
    dispatching,
    busy,
    blocked,
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
    dispatching: boolean;
    busy: boolean;
    blocked: boolean;
    onLaunch: () => void;
    onConfigure: () => void;
    onRemove: () => void;
  } = $props();
</script>

<article class="pin-card">
  <div class="pin-content">
    <div class="pin-title-line">
      <h3>{pin.label}</h3>
      {#if uncertain}<span class="pin-ref"
          ><Icon name="branch" size={11} />{pin.ref}</span
        >{/if}
    </div>
    <p class="pin-repo">
      {repo}<span class="pin-account" title={`Konto ${account}`}
        >{' · '}{account}</span
      >
    </p>
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
      disabled={dispatching || (pin.quickStart && (blocked || uncertain))}
      ><Icon name={pin.quickStart ? 'bolt' : 'play'} size={13} />{pin.quickStart
        ? 'Schnellstart'
        : 'Starten…'}</button
    >
    {#if pin.quickStart}<button
        class="icon-button pin-configure"
        aria-label={`Favorit ${pin.label} starten…`}
        title="Starten…"
        onclick={() => onConfigure()}
        disabled={dispatching}><Icon name="settings" size={14} /></button
      >{/if}
    <button
      class="icon-button small delete-pin"
      aria-label={`Favorit ${pin.label} entfernen`}
      title="Favorit entfernen"
      onclick={() => onRemove()}
      disabled={busy}><Icon name="trash" size={14} /></button
    >
  </div>
</article>
