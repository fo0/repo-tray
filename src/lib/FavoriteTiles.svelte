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
    /** Full repository name, e.g. `owner/name`. */
    repoName: (repoId: string) => string;
    accountName: (accountId: string) => string;
    /** What a favorite's controls may do right now (`Starts.gate`). */
    gate: (pin: Pin) => StartGate;
    onConfigure: (pin: Pin) => void;
    onRemove: (pinId: string) => void;
    onLaunch: (pin: Pin) => void;
  } = $props();
</script>

<!-- Two tiles per row. The name opens the start dialog with the stored
     inputs (its hit area covers the tile), the round button starts. -->
<ul class="tiles">
  {#each pins as pin (pin.id)}
    {@const uncertain = isUncertain(pin)}
    {@const can = gate(pin)}
    {@const names = favoriteNames(pin.label)}
    {@const repo = repoName(pin.repoId)}
    <!-- `data-pin-*` lets focus move to a neighbour or a restored tile; the
         name comes first, so a restored tile focuses it. -->
    <li class="tile" class:uncertain data-pin-id={pin.id}>
      <button
        class="tile-open"
        onclick={() => onConfigure(pin)}
        aria-label={names.open}
        title={can.openReason ??
          `${pin.label} · ${repo} · ${pin.ref} · ${accountName(pin.accountId)}`}
        disabled={!can.canOpen}
      >
        <strong class="tile-title">{pin.label}</strong>
        <span class="tile-repo">{repo.split('/').pop()}</span>
      </button>
      <button
        class="icon-button tile-heart"
        data-pin-remove
        aria-label={names.remove}
        title="Favorit entfernen"
        disabled={!can.canRemove}
        onclick={() => onRemove(pin.id)}><Icon name="heart" size={14} /></button
      >
      <div class="tile-foot">
        <span class="branch-chip"
          ><Icon name="branch" size={11} /><span>{pin.ref}</span></span
        >
        {#if uncertain}<span
            class="tile-warning"
            title="Startstatus ungeklärt · Wähle den Favoriten, um den Status zu prüfen"
            role="img"
            aria-label={names.uncertain}><Icon name="warning" size={14} /></span
          >{/if}
        <!-- Without quick start this button opens the same dialog as the
             name: one control for assistive tech and the keyboard. Off via
             aria-disabled, so a start that locks it keeps focus here. -->
        <button
          class="tile-start"
          class:quick={pin.quickStart}
          onclick={() => can.canStart && onLaunch(pin)}
          aria-disabled={can.canStart ? undefined : 'true'}
          aria-label={pin.quickStart ? names.quickStart : names.open}
          aria-hidden={pin.quickStart ? undefined : 'true'}
          tabindex={pin.quickStart ? undefined : -1}
          title={can.reason ??
            (pin.quickStart
              ? 'Schnellstart · ohne Bestätigung mit den gespeicherten Eingaben starten'
              : 'Gespeicherte Eingaben prüfen und starten')}
          ><Icon name={pin.quickStart ? 'bolt' : 'play'} size={13} /></button
        >
      </div>
    </li>
  {/each}
</ul>
