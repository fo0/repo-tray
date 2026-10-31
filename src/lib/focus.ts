/** A small modal focus loop, including focus restoration when the dialog closes. */
export function trapFocus(node: HTMLElement) {
  const previous = document.activeElement as HTMLElement | null;
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
    destroy() {
      node.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    },
  };
}
