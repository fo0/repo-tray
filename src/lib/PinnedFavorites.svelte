<script lang="ts">
  import Icon from './Icon.svelte';
  import { plural } from './format';
  import { START_REASONS, startReason } from './startReason';
  import type { DispatchTarget, Pin } from './types';

  let {
    pins,
    isUncertain,
    repoName,
    accountName,
    isStarting,
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
    /** A start for this target is running; only that target is locked. */
    isStarting: (target: DispatchTarget) => boolean;
    busy: boolean;
    /** Why starts are off for every target (offline, forbidden); null otherwise. */
    blocked: string | null;
    onConfigure: (pin: Pin) => void;
    onRemove: (pinId: string) => void;
    onLaunch: (pin: Pin) => void;
  } = $props();
</script>

{#if pins.length}
  <section class="repository-favorites" aria-label="Favoriten">
    <div class="section-heading pinned-heading">
      <h2><Icon name="heart" size={13} />Favoriten</h2>
      <span>{plural(pins.length, 'Favorit', 'Favoriten')}</span>
    </div>
    <div class="pinned-list">
      {#each pins as pin (pin.id)}
        {@const uncertain = isUncertain(pin)}
        {@const starting = isStarting(pin)}
        {@const reason = pin.quickStart
          ? startReason({ blocked, running: starting, uncertain })
          : startReason({ running: starting })}
        <!-- `data-pin-*` lets focus move to a neighbour or a restored card. -->
        <article class="pinned-action" class:uncertain data-pin-id={pin.id}>
          <button
            class="pinned-copy"
            onclick={() => onConfigure(pin)}
            aria-label={`Favorit ${pin.label} öffnen…`}
            title={starting
              ? START_REASONS.running
              : `${pin.label} · ${repoName(pin.repoId)} · ${pin.ref} · ${accountName(pin.accountId)}`}
            disabled={starting}
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
            data-pin-remove
            aria-label={`Favorit ${pin.label} entfernen`}
            title="Favorit entfernen"
            disabled={busy || starting}
            onclick={() => onRemove(pin.id)}
            ><Icon name="heart" size={15} /></button
          >
          <button
            class="action-start pinned-start"
            onclick={() => onLaunch(pin)}
            disabled={!!reason}
            aria-label={pin.quickStart
              ? undefined
              : `Favorit ${pin.label} starten…`}
            title={reason ??
              (pin.quickStart
                ? 'Ohne Bestätigung mit den gespeicherten Eingaben starten'
                : 'Gespeicherte Eingaben prüfen und starten')}
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
