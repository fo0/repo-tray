import { describe, expect, it } from 'vitest';
import vectors from '../../fixtures/run-links.json';
import { safeGitHubUrl } from './safeGitHubUrl';

// Shared with `canonical_run_url` in src-tauri/src/run_link.rs: the panel shows
// a run link only when the shell would open it, and both open the same string.
describe('safeGitHubUrl', () => {
  it('has accepted and rejected vectors', () => {
    expect(vectors.some((v) => v.expected === null)).toBe(true);
    expect(vectors.some((v) => v.expected !== null)).toBe(true);
  });
  for (const { input, expected } of vectors)
    it(`${expected === null ? 'rejects' : 'accepts'} ${JSON.stringify(input)}`, () => {
      expect(safeGitHubUrl(input)).toBe(expected);
    });
});
