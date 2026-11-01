<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    id,
    quickStart,
    demo = true,
  }: { id: string; quickStart: boolean; demo?: boolean } = $props();
  let trigger = $state<HTMLButtonElement>();
  let tooltip = $state<HTMLDivElement>();
  let hovered = $state(false);
  let focused = $state(false);
  let pinned = $state(false);
  let suppressed = $state(false);
  let left = $state(12);
  let top = $state(12);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const visible = $derived(!suppressed && (hovered || focused || pinned));

  function portal(node: HTMLElement) {
    document.body.append(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
  function position() {
    if (!visible || !trigger || !tooltip) return;
    const anchor = trigger.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    left = Math.max(12, Math.min(anchor.left, innerWidth - box.width - 12));
    const below = anchor.bottom + 7;
    top =
      below + box.height <= innerHeight - 12
        ? below
        : Math.max(12, anchor.top - box.height - 7);
  }
  function enter() {
    clearTimeout(closeTimer);
    hovered = true;
    suppressed = false;
  }
  function leave() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      hovered = false;
    }, 140);
  }
  function dismiss() {
    clearTimeout(closeTimer);
    hovered = false;
    focused = false;
    pinned = false;
    suppressed = true;
  }
  function toggle() {
    if (pinned) dismiss();
    else {
      pinned = true;
      suppressed = false;
    }
  }
  $effect(() => {
    if (visible) void tick().then(position);
  });
  onMount(() => {
    const outside = (event: PointerEvent | FocusEvent) => {
      if (
        event.target instanceof Node &&
        !trigger?.contains(event.target) &&
        !tooltip?.contains(event.target)
      )
        dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (visible && event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      }
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !tooltip?.contains(event.target))
        dismiss();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', position);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', position);
    };
  });
  onDestroy(() => clearTimeout(closeTimer));
</script>

<button
  type="button"
  class="uncertain-start"
  bind:this={trigger}
  aria-describedby={id}
  aria-controls={id}
  aria-expanded={visible}
  onpointerenter={enter}
  onpointerleave={leave}
  onfocus={() => {
    focused = true;
    suppressed = false;
  }}
  onblur={() => {
    focused = false;
    pinned = false;
  }}
  onclick={toggle}
>
  <Icon name="warning" size={12} /><span>Startstatus ungeklärt</span>
</button>
<div
  class="uncertain-start-tip"
  bind:this={tooltip}
  use:portal
  {id}
  role="tooltip"
  hidden={!visible}
  style:left={`${left}px`}
  style:top={`${top}px`}
  onpointerenter={enter}
  onpointerleave={leave}
>
  <strong><Icon name="warning" size={14} />Startstatus ungeklärt</strong>
  <p>
    GitHub hat den Start nicht bestätigt. Der Workflow läuft eventuell bereits.
    Ein erneuter Start für diesen Workflow und Branch bleibt gesperrt.
  </p>
  <p>
    {quickStart
      ? 'Wähle das Zahnrad „Starten…“, dann „Status prüfen“ oder nach der Prüfung auf GitHub „Sperre aufheben…“.'
      : 'Wähle „Starten…“, dann „Status prüfen“ oder nach der Prüfung auf GitHub „Sperre aufheben…“.'}
  </p>
  <p class="tip-mode">
    Favorit: {quickStart ? 'Schnellstart aktiviert' : 'mit Bestätigung'}. {demo
      ? 'Die Beispielsperre hebst du im Startdialog oder mit „Demo zurücksetzen“ auf.'
      : 'Die Startsperre bleibt auch nach einem Neustart erhalten, bis du sie aufhebst.'}
  </p>
</div>

<style>
  .uncertain-start {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 24px;
    max-width: 100%;
    min-width: 0;
    margin: -5px 0;
    padding: 5px 0;
    border: 0;
    background: transparent;
    color: var(--warning);
    font: inherit;
    font-size: 11px;
    line-height: 14px;
    text-align: left;
    cursor: help;
  }
  .uncertain-start > span {
    overflow-wrap: anywhere;
  }
  .uncertain-start :global(svg) {
    flex-shrink: 0;
  }
  .uncertain-start:hover {
    color: #efd29a;
  }
  .uncertain-start:focus-visible {
    outline: 2px solid var(--warning);
    outline-offset: 2px;
    border-radius: 3px;
  }
  .uncertain-start-tip {
    position: fixed;
    z-index: 1000;
    width: 288px;
    max-width: calc(100vw - 24px);
    max-height: calc(100dvh - 24px);
    overflow: auto;
    padding: 12px;
    border: 1px solid #7c643c;
    border-radius: 8px;
    background: #302a1d;
    color: #dcc391;
    box-shadow: 0 8px 28px #0008;
    font-size: 12px;
    line-height: 1.55;
  }
  .uncertain-start-tip[hidden] {
    display: none;
  }
  .uncertain-start-tip strong {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #f0d39c;
  }
  .uncertain-start-tip p {
    margin: 7px 0 0;
  }
  .uncertain-start-tip .tip-mode {
    color: #bca980;
    font-size: 11px;
  }
</style>
