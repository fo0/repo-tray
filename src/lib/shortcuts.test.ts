import { describe, expect, it, vi } from 'vitest';
import {
  createShortcuts,
  isTypingTarget,
  shortcutFor,
  type ShortcutActions,
} from './shortcuts';

const press = (key: string, extra: Partial<KeyboardEvent> = {}) => ({
  key,
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});

describe('shortcutFor', () => {
  it('maps F5 and Ctrl+R (any case, any layout) to refresh', () => {
    expect(shortcutFor(press('F5'))).toEqual({ kind: 'refresh' });
    expect(shortcutFor(press('r', { ctrlKey: true }))).toEqual({
      kind: 'refresh',
    });
    expect(shortcutFor(press('R', { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'refresh',
    });
    // Cyrillic layout: the physical R key still reloads a webview.
    expect(shortcutFor(press('к', { ctrlKey: true, code: 'KeyR' }))).toEqual({
      kind: 'refresh',
    });
    // Dvorak: the key labelled R is what counts, not its position.
    expect(shortcutFor(press('p', { ctrlKey: true, code: 'KeyR' }))).toBeNull();
    expect(shortcutFor(press('r'))).toBeNull();
  });
  it('maps Ctrl+1/2/3 from the digit row or keypad to the view tabs', () => {
    expect(shortcutFor(press('1', { ctrlKey: true }))).toEqual({
      kind: 'tab',
      tab: 'repositories',
    });
    expect(shortcutFor(press('&', { ctrlKey: true, code: 'Digit2' }))).toEqual({
      kind: 'tab',
      tab: 'activity',
    });
    expect(shortcutFor(press('3', { ctrlKey: true, code: 'Numpad3' }))).toEqual(
      { kind: 'tab', tab: 'launch' },
    );
    expect(shortcutFor(press('4', { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(press('1'))).toBeNull();
    expect(
      shortcutFor(press('1', { ctrlKey: true, shiftKey: true })),
    ).toBeNull();
  });
  it('keeps / (also typed with Shift) for search and Escape', () => {
    expect(shortcutFor(press('/', { shiftKey: true }))).toEqual({
      kind: 'search',
    });
    expect(shortcutFor(press('/', { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(press('Escape'))).toEqual({ kind: 'escape' });
  });
  it('leaves Alt and AltGr combinations to the keyboard layout', () => {
    expect(shortcutFor(press('1', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutFor(press('F5', { altKey: true }))).toBeNull();
  });
});

describe('isTypingTarget', () => {
  it('detects text entry, pickers and editable content', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT'])
      expect(isTypingTarget({ tagName } as unknown as EventTarget)).toBe(true);
    expect(
      isTypingTarget({
        tagName: 'DIV',
        isContentEditable: true,
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget),
    ).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('createShortcuts', () => {
  const setup = (blocked = false, escapes = false) => {
    const actions = {
      blocked: () => blocked,
      refresh: vi.fn(),
      selectTab: vi.fn(),
      focusSearch: vi.fn(),
      escape: vi.fn(() => escapes),
    } satisfies ShortcutActions;
    return { actions, handle: createShortcuts(actions) };
  };
  const event = (
    key: string,
    extra: Partial<KeyboardEvent> = {},
    tagName = 'BODY',
  ) => {
    const value = {
      target: { tagName },
      defaultPrevented: false,
      isComposing: false,
      ...press(key, extra),
      preventDefault: vi.fn(() => {
        value.defaultPrevented = true;
      }),
    };
    return value;
  };
  const run = (
    handle: (event: KeyboardEvent) => void,
    value: ReturnType<typeof event>,
  ) => handle(value as unknown as KeyboardEvent);

  it('refreshes instead of reloading and switches tabs', () => {
    const { actions, handle } = setup();
    const reload = event('F5');
    run(handle, reload);
    expect(reload.preventDefault).toHaveBeenCalled();
    expect(actions.refresh).toHaveBeenCalledTimes(1);
    const tab = event('2', { ctrlKey: true });
    run(handle, tab);
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(actions.selectTab).toHaveBeenCalledWith('activity');
    run(handle, event('/'));
    expect(actions.focusSearch).toHaveBeenCalledTimes(1);
  });
  it('ignores everything but Escape while typing, yet never reloads', () => {
    const { actions, handle } = setup(false, true);
    const reload = event('r', { ctrlKey: true }, 'INPUT');
    run(handle, reload);
    expect(reload.preventDefault).toHaveBeenCalled();
    expect(actions.refresh).not.toHaveBeenCalled();
    const slash = event('/', {}, 'INPUT');
    run(handle, slash);
    expect(slash.preventDefault).not.toHaveBeenCalled();
    run(handle, event('1', { ctrlKey: true }, 'SELECT'));
    expect(actions.focusSearch).not.toHaveBeenCalled();
    expect(actions.selectTab).not.toHaveBeenCalled();
    const escape = event('Escape', {}, 'INPUT');
    run(handle, escape);
    expect(actions.escape).toHaveBeenCalledWith(escape.target);
    expect(escape.preventDefault).toHaveBeenCalled();
  });
  it('leaves the keyboard to an open dialog but still blocks a reload', () => {
    const { actions, handle } = setup(true);
    const reload = event('F5');
    run(handle, reload);
    expect(reload.preventDefault).toHaveBeenCalled();
    for (const value of [
      event('/'),
      event('Escape'),
      event('3', { ctrlKey: true }),
    ])
      run(handle, value);
    expect(actions.refresh).not.toHaveBeenCalled();
    expect(actions.focusSearch).not.toHaveBeenCalled();
    expect(actions.escape).not.toHaveBeenCalled();
    expect(actions.selectTab).not.toHaveBeenCalled();
  });
  it('skips keys another handler already took or an IME is composing', () => {
    const { actions, handle } = setup();
    const taken = event('/');
    taken.defaultPrevented = true;
    run(handle, taken);
    run(handle, event('/', { isComposing: true }));
    expect(actions.focusSearch).not.toHaveBeenCalled();
    const unhandled = event('Escape');
    run(handle, unhandled);
    expect(unhandled.preventDefault).not.toHaveBeenCalled();
  });
});
