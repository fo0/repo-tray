<script lang="ts">
  import Icon from './Icon.svelte';
  import UncertainStartHelp from './UncertainStartHelp.svelte';
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
    help = false,
    demo = true,
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
    /** The uncertain marker opens its help (Favoriten page), not just a tooltip. */
    help?: boolean;
    demo?: boolean;
  } = $props();
</script>

<!-- One compact row per favorite, on the overview and its page alike. The
     name opens the start dialog with the stored inputs (its hit area covers
     the row), the round button starts, the heart removes. -->
<ul class="pin-rows">
  {#each pins as pin (pin.id)}
    {@const uncertain = isUncertain(pin)}
    {@const can = gate(pin)}
    {@const repo = repoName(pin.repoId)}
    {@const short = repo.split('/').pop() ?? repo}
    {@const names = favoriteNames(short, pin.label)}
    <!-- `data-pin-*` lets focus move to a neighbour or a restored row; the
         name comes first, so a restored row focuses it. Its start and name
         are off via aria-disabled: a start that locks them keeps focus. -->
    <li class="pin-row" class:uncertain data-pin-id={pin.id}>
      <button
        class="pin-open"
        onclick={() => can.canOpen && onConfigure(pin)}
        aria-label={names.open}
        title={can.openReason ??
          `${repo} · ${pin.label} · ${pin.ref} · ${accountName(pin.accountId)}`}
        aria-disabled={can.canOpen ? undefined : 'true'}
        ><strong class="pin-repo">{short}</strong><span class="pin-label"
          >{pin.label}</span
        ></button
      >
      <span class="branch-chip"
        ><Icon name="branch" size={11} /><span>{pin.ref}</span></span
      >
      {#if uncertain}{#if help}<UncertainStartHelp
            id={`uncertain-help-${pin.id}`}
            name={names.uncertain}
            quickStart={pin.quickStart}
            {demo}
          />{:else}<span
            class="pin-warning"
            title="Startstatus ungeklärt"
            role="img"
            aria-label={names.uncertain}><Icon name="warning" size={13} /></span
          >{/if}{/if}
      <!-- Without quick start this button opens the same dialog as the
           name: one control for assistive tech and the keyboard. -->
      <button
        class="pin-start"
        class:quick={pin.quickStart}
        onclick={() => can.canStart && onLaunch(pin)}
        aria-disabled={can.canStart ? undefined : 'true'}
        aria-label={pin.quickStart ? names.quickStart : names.open}
        aria-hidden={pin.quickStart ? undefined : 'true'}
        tabindex={pin.quickStart ? undefined : -1}
        title={can.reason ?? (pin.quickStart ? 'Schnellstart' : 'Starten…')}
        ><Icon name={pin.quickStart ? 'bolt' : 'play'} size={12} /></button
      >
      <button
        class="icon-button small pin-heart"
        data-pin-remove
        aria-label={names.remove}
        title="Favorit entfernen"
        disabled={!can.canRemove}
        onclick={() => onRemove(pin.id)}><Icon name="heart" size={14} /></button
      >
    </li>
  {/each}
</ul>
