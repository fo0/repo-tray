import type { ViewTab } from './ViewTabs.svelte';

export type Shortcut =
  | { kind: 'refresh' }
  | { kind: 'tab'; tab: ViewTab }
  | { kind: 'search' }
  | { kind: 'escape' };

type KeyPress = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

export interface ShortcutActions {
  /** A dialog is open; it owns the keyboard (Escape, focus trap). */
  blocked: () => boolean;
  /** Refreshes when the panel's refresh button would be enabled. */
  refresh: () => void;
  selectTab: (tab: ViewTab) => void;
  focusSearch: () => void;
  /** Escape on `target`; returns whether something (the search) handled it. */
  escape: (target: EventTarget | null) => boolean;
}

/** Ctrl+1/2/3 in the order of the view tabs. */
export const TAB_ORDER: readonly ViewTab[] = [
  'repositories',
  'activity',
  'launch',
];

/** The „Tastenkürzel“ hint, one shortcut per line (tooltip text). */
export const SHORTCUT_HINT = [
  'Tastenkürzel',
  '/ – Suche',
  'F5 oder Strg+R – Aktualisieren',
  'Strg+1, 2, 3 – Repositories, Aktivität, Favoriten',
  'Esc – Suche leeren oder verlassen, Dialog schließen',
].join('\n');

/** A Latin letter by its key; other layouts fall back to the physical key. */
function isLetter(event: KeyPress, letter: string) {
  const key = event.key.toLowerCase();
  return /^[a-z]$/.test(key)
    ? key === letter
    : event.code === `Key${letter.toUpperCase()}`;
}

/** Maps a key press to a panel shortcut, independent of focus and state. */
export function shortcutFor(event: KeyPress): Shortcut | null {
  const command = event.ctrlKey || event.metaKey;
  // Alt (and AltGr, reported as Ctrl+Alt on Windows) types characters.
  if (event.altKey) return null;
  if (event.key === 'F5' || (command && isLetter(event, 'r')))
    return { kind: 'refresh' };
  if (command) {
    if (event.shiftKey) return null;
    const digit =
      /^(?:Digit|Numpad)([1-3])$/.exec(event.code)?.[1] ??
      /^[1-3]$/.exec(event.key)?.[0];
    const tab = digit ? TAB_ORDER[Number(digit) - 1] : undefined;
    return tab ? { kind: 'tab', tab } : null;
  }
  if (event.key === 'Escape') return { kind: 'escape' };
  if (event.key === '/') return { kind: 'search' };
  return null;
}

/** Text entry or a native picker, where plain keys belong to the control. */
export function isTypingTarget(target: EventTarget | null) {
  const element = target as Partial<HTMLElement> | null;
  return (
    !!element &&
    (element.isContentEditable === true ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName ?? ''))
  );
}

/**
 * Window keydown handler for the panel shortcuts. A reload is always
 * suppressed, since it would drop open dialogs and typed input; while a dialog
 * is open nothing else runs. Only `/` types a character, so only it yields to
 * a focused text field; F5, Ctrl+R and Ctrl+1-3 work from the search field too.
 */
export function createShortcuts(actions: ShortcutActions) {
  return (event: KeyboardEvent) => {
    const shortcut = shortcutFor(event);
    if (!shortcut) return;
    const handled = event.defaultPrevented;
    if (shortcut.kind === 'refresh') event.preventDefault();
    if (handled || event.isComposing || actions.blocked()) return;
    if (shortcut.kind === 'search' && isTypingTarget(event.target)) return;
    switch (shortcut.kind) {
      case 'refresh':
        actions.refresh();
        return;
      case 'tab':
        event.preventDefault();
        actions.selectTab(shortcut.tab);
        return;
      case 'search':
        event.preventDefault();
        actions.focusSearch();
        return;
      case 'escape':
        if (actions.escape(event.target)) event.preventDefault();
    }
  };
}
