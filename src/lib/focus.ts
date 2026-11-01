export interface TrapFocusOptions {
  /**
   * Element that receives focus when the dialog closes. Chained dialogs pass
   * the opener of the first dialog so focus returns there, not to a button of
   * a dialog that no longer exists.
   */
  returnFocus?: () => HTMLElement | null | undefined;
}

/** Focus was dropped (the focused element was removed or made inert). */
function focusLost() {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

/**
 * Restores focus once the page behind the dialog is interactive again: the
 * dialog's `destroy()` runs while the background is still `inert`, where
 * `focus()` is silently ignored. Never steals focus that was placed
 * deliberately in the meantime, and leaves it to a dialog that replaced this one.
 */
function restoreFocus(target: HTMLElement | null | undefined, frames = 3) {
  if (!target?.isConnected || !focusLost()) return;
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
  if (target.closest('[inert]')) {
    if (frames > 0)
      requestAnimationFrame(() => restoreFocus(target, frames - 1));
    return;
  }
  target.focus();
}

/** A small modal focus loop, including focus restoration when the dialog closes. */
export function trapFocus(node: HTMLElement, options: TrapFocusOptions = {}) {
  const active = document.activeElement;
  const previous = active instanceof HTMLElement ? active : null;
  let returnFocus = options.returnFocus;
  const focusable = () =>
    [
      ...node.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]',
      ),
    ].filter(
      (item) =>
        !item.closest('details:not([open])') || item.tagName === 'SUMMARY',
    );
  queueMicrotask(() => (focusable()[0] ?? node).focus());
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const items = focusable();
    if (!items.length) {
      event.preventDefault();
      node.focus();
      return;
    }
    const first = items[0],
      last = items[items.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === node)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  node.addEventListener('keydown', onKey);
  return {
    update(next: TrapFocusOptions = {}) {
      returnFocus = next.returnFocus;
    },
    destroy() {
      node.removeEventListener('keydown', onKey);
      const target = returnFocus?.() ?? previous;
      // Runs after the current flush, when `inert` has been lifted.
      queueMicrotask(() => restoreFocus(target));
    },
  };
}
