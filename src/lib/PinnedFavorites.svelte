<script lang="ts">
  import Icon from './Icon.svelte';
  import { favoriteNames, type StartGate } from './startReason';
  import type { Pin } from './types';

  let {
    pins,
    isUncertain,
    repoName,
    accountName,
    gate,
    onConfigure,
    onRemove,
    onLaunch,
  }: {
    pins: Pin[];
    /** The pin's target has a start with unknown outcome; quick start stays locked. */
    isUncertain: (pin: Pin) => boolean;
    repoName: (repoId: string) => string;
    accountName: (accountId: string) => string;
    /** What a favorite's controls may do right now (`Starts.gate`). */
    gate: (pin: Pin) => StartGate;
    onConfigure: (pin: Pin) => void;
    onRemove: (pinId: string) => void;
    onLaunch: (pin: Pin) => void;
  } = $props();
</script>

<!-- The overview's Favoriten section names the list; tiles replace it later. -->
{#if pins.length}
  <div class="pinned-list">
    {#each pins as pin (pin.id)}
      {@const uncertain = isUncertain(pin)}
      {@const can = gate(pin)}
      {@const names = favoriteNames(pin.label)}
      <!-- `data-pin-*` lets focus move to a neighbour or a restored card. -->
      <article class="pinned-action" class:uncertain data-pin-id={pin.id}>
        <button
          class="pinned-copy"
          onclick={() => onConfigure(pin)}
          aria-label={names.open}
          title={can.openReason ??
            `${pin.label} · ${repoName(pin.repoId)} · ${pin.ref} · ${accountName(pin.accountId)}`}
          disabled={!can.canOpen}
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
            aria-label={names.uncertain}><Icon name="warning" size={14} /></span
          >{/if}
        <button
          class="icon-button pinned-remove"
          data-pin-remove
          aria-label={names.remove}
          title="Favorit entfernen"
          disabled={!can.canRemove}
          onclick={() => onRemove(pin.id)}
          ><Icon name="heart" size={15} /></button
        >
        <!-- Without quick start this chip opens the same dialog as the
               row: one control for assistive tech and the keyboard. Off via
               aria-disabled, so a start that locks it keeps focus here. -->
        <button
          class="action-start pinned-start"
          onclick={() => can.canStart && onLaunch(pin)}
          aria-disabled={can.canStart ? undefined : 'true'}
          aria-label={pin.quickStart ? names.quickStart : names.open}
          aria-hidden={pin.quickStart ? undefined : 'true'}
          tabindex={pin.quickStart ? undefined : -1}
          title={can.reason ??
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
{/if}
