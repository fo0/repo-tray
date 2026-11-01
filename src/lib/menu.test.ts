import { describe, expect, it } from 'vitest';
import { menuIndex, openingFocus } from './menu';

describe('menuIndex', () => {
  it('moves down and up one item and wraps at both ends', () => {
    expect(menuIndex('ArrowDown', 0, 4)).toBe(1);
    expect(menuIndex('ArrowDown', 3, 4)).toBe(0);
    expect(menuIndex('ArrowUp', 2, 4)).toBe(1);
    expect(menuIndex('ArrowUp', 0, 4)).toBe(3);
  });
  it('enters the list from either end while no item has focus', () => {
    expect(menuIndex('ArrowDown', -1, 4)).toBe(0);
    expect(menuIndex('ArrowUp', -1, 4)).toBe(3);
  });
  it('jumps to the first and last item with Home/End and PageUp/PageDown', () => {
    expect(menuIndex('Home', 2, 4)).toBe(0);
    expect(menuIndex('PageUp', 2, 4)).toBe(0);
    expect(menuIndex('End', 1, 4)).toBe(3);
    expect(menuIndex('PageDown', 1, 4)).toBe(3);
  });
  it('leaves other keys and empty menus alone', () => {
    expect(menuIndex('Enter', 1, 4)).toBeNull();
    expect(menuIndex('a', 1, 4)).toBeNull();
    expect(menuIndex('ArrowLeft', 1, 4)).toBeNull();
    expect(menuIndex('ArrowDown', -1, 0)).toBeNull();
  });
});

describe('openingFocus', () => {
  it('opens on the first item with ArrowDown and on the last with ArrowUp', () => {
    expect(openingFocus('ArrowDown')).toBe('first');
    expect(openingFocus('ArrowUp')).toBe('last');
  });
  it('leaves Enter and Space to the button click', () => {
    expect(openingFocus('Enter')).toBeNull();
    expect(openingFocus(' ')).toBeNull();
  });
});
