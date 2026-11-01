<script lang="ts">
  import Icon from './Icon.svelte';
  import { plural } from './format';
  import type { Pin } from './types';

  let {
    pins,
    isUncertain,
    repoName,
    accountName,
    dispatching,
    busy,
    blocked,
    onConfigure,
    onRemove,
    onLaunch,
  }: {
    pins: Pin[];
    /** The pin's target has a start with unknown outcome; quick start stays locked. */
    isUncertain: (pin: Pin) => boolean;
    repoName: (repoId: string) => string;
    accountName: (accountId: string) => string;
    dispatching: boolean;
    busy: boolean;
    blocked: boolean;
    onConfigure: (pin: Pin) => void;
    onRemove: (pinId: string) => void;
    onLaunch: (pin: Pin) => void;
  } = $props();
</script>

{#if pins.length}
  <section class="repository-favorites" aria-label="Favoriten">
    <div class="section-heading pinned-heading">
      <h2><Icon name="pin" size={13} />Favoriten</h2>
      <span>{plural(pins.length, 'Favorit', 'Favoriten')}</span>
    </div>
    <div class="pinned-list">
      {#each pins as pin (pin.id)}
        {@const uncertain = isUncertain(pin)}
        <article class="pinned-action" class:uncertain>
          <button
            class="pinned-copy"
            onclick={() => onConfigure(pin)}
            aria-label={`Favorit ${pin.label} starten…`}
            title={`${pin.label} · ${repoName(pin.repoId)} · ${pin.ref} · ${accountName(pin.accountId)}`}
            disabled={dispatching}
          >
            <strong>{pin.label}</strong>
            <small
              ><span>{repoName(pin.repoId)}</span><span class="pinned-ref"
                >· {pin.ref}</span
              ></small
            >
          </button>
          {#if uncertain}<span
              class="pinned-warning"
              title="Startstatus ungeklärt · Wähle den Favoriten, um den Status zu prüfen"
              role="img"
              aria-label="Startstatus ungeklärt"
              ><Icon name="warning" size={14} /></span
            >{/if}
          <button
            class="icon-button pinned-remove"
            aria-label={`Favorit ${pin.label} entfernen`}
            title="Favorit entfernen"
            disabled={busy || dispatching}
            onclick={() => onRemove(pin.id)}
            ><Icon name="heart" size={15} /></button
          >
          <button
            class="action-start pinned-start"
            onclick={() => onLaunch(pin)}
            disabled={dispatching || (pin.quickStart && (blocked || uncertain))}
            title={pin.quickStart
              ? 'Ohne Bestätigung mit den gespeicherten Eingaben starten'
              : 'Gespeicherte Eingaben prüfen und starten'}
          >
            <Icon
              name={pin.quickStart ? 'bolt' : 'play'}
              size={12}
            />{pin.quickStart ? 'Schnellstart' : 'Starten…'}
          </button>
        </article>
      {/each}
    </div>
  </section>
{/if}
