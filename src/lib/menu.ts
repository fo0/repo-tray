/**
 * Keyboard and pointer behaviour of a popup menu (WAI-ARIA menu button
 * pattern): arrow keys, Home and End move focus between the items, Escape
 * closes and returns focus to the menu button, Tab closes and lets focus move
 * on from the button, and a click or focus outside closes the menu.
 */

/** Where focus goes when the menu opens. */
export type MenuFocus = 'first' | 'last';

/**
 * The item index a key moves focus to, wrapping at both ends, or null for a
 * key the menu leaves alone. `current` is -1 while no item has focus.
 */
export function menuIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (count < 1) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case 'Home':
    case 'PageUp':
      return 0;
    case 'End':
    case 'PageDown':
      return count - 1;
    default:
      return null;
  }
}

/** Arrow keys on the closed menu button open it; Enter and Space click it. */
export function openingFocus(key: string): MenuFocus | null {
  return key === 'ArrowDown' ? 'first' : key === 'ArrowUp' ? 'last' : null;
}

export interface MenuOptions {
  /** The menu button: Escape and Tab return focus to it. */
  trigger: HTMLElement | undefined;
  /** The item that receives focus when the menu opens. */
  initial?: MenuFocus;
  /** Closes the menu; called at most once per opening. */
  onClose: () => void;
}

/** Enabled items in document order. */
function items(node: HTMLElement) {
  return [
    ...node.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
    ),
  ].filter(
    (item) =>
      item.getAttribute('aria-disabled') !== 'true' &&
      !(item instanceof HTMLButtonElement && item.disabled),
  );
}

/**
 * Svelte action for an open `role="menu"` element: focuses the first (or
 * last) item and handles the keys and outside interaction above. Escape calls
 * `preventDefault`, so the panel's own Escape handling skips that key press.
 */
export function menu(node: HTMLElement, options: MenuOptions) {
  let current = options;
  let closed = false;
  const inside = (target: EventTarget | null) =>
    target instanceof Node &&
    (node.contains(target) || !!current.trigger?.contains(target));
  const close = (refocus: boolean) => {
    if (closed) return;
    closed = true;
    if (refocus) current.trigger?.focus();
    current.onClose();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    // Focus moves back to the button first, so the browser's own Tab step
    // continues from there instead of from an item that is about to vanish.
    if (event.key === 'Tab') {
      close(true);
      return;
    }
    const list = items(node);
    const active = document.activeElement;
    const next = menuIndex(
      event.key,
      list.findIndex((item) => item === active),
      list.length,
    );
    if (next === null) return;
    event.preventDefault();
    list[next]?.focus();
  };
  const onPointer = (event: PointerEvent) => {
    if (!inside(event.target)) close(false);
  };
  const onFocusOut = (event: FocusEvent) => {
    if (!inside(event.relatedTarget)) close(false);
  };
  node.addEventListener('keydown', onKey);
  node.addEventListener('focusout', onFocusOut);
  document.addEventListener('pointerdown', onPointer, true);
  const list = items(node);
  (current.initial === 'last' ? list.at(-1) : list[0])?.focus();
  return {
    update(next: MenuOptions) {
      current = next;
    },
    destroy() {
      node.removeEventListener('keydown', onKey);
      node.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointer, true);
    },
  };
}
