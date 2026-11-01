import { describe, expect, it } from 'vitest';
import { Notices } from './notices.svelte';

describe('Notices', () => {
  it('evicts the oldest success first and keeps warnings and errors', () => {
    const notices = new Notices();
    notices.show({ key: 'a', text: 'Ungeklärt', tone: 'warning' });
    notices.show({ key: 'b', text: 'Fehler', tone: 'danger' });
    for (const key of ['c', 'd', 'e', 'f'])
      notices.show({ key, text: `Erfolg ${key}`, tone: 'subtle' });
    expect(notices.items.map((item) => item.text)).toEqual([
      'Ungeklärt',
      'Fehler',
      'Erfolg e',
      'Erfolg f',
    ]);
  });

  it('never evicts a warning or error, and still shows the newest success', () => {
    const notices = new Notices();
    for (const key of ['a', 'b', 'c', 'd'])
      notices.show({ key, text: `Warnung ${key}`, tone: 'warning' });
    notices.show({ key: 'e', text: 'Erfolg', tone: 'subtle' });
    expect(notices.items.map((item) => item.text)).toEqual([
      'Warnung a',
      'Warnung b',
      'Warnung c',
      'Warnung d',
      'Erfolg',
    ]);
    // An error over the limit pushes out the success, never a warning.
    notices.show({ key: 'f', text: 'Fehler', tone: 'danger' });
    notices.show({ key: 'g', text: 'Neuer Erfolg', tone: 'subtle' });
    expect(notices.items.map((item) => item.text)).toEqual([
      'Warnung a',
      'Warnung b',
      'Warnung c',
      'Warnung d',
      'Fehler',
      'Neuer Erfolg',
    ]);
  });
});
