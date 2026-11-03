import { describe, expect, it } from 'vitest';
import repoVectors from '../../fixtures/repo-links.json';
import vectors from '../../fixtures/run-links.json';
import { safeGitHubUrl, safeRepoUrl } from './safeGitHubUrl';

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

// Shared with `canonical_repo_url` in src-tauri/src/run_link.rs: the panel
// builds a repository page only when the shell would open exactly that string.
// The rejected vectors guard a multiline regex, a looser charset or a port of
// this check: line breaks, control and bidi characters, userinfo, ports,
// backslashes and encoded traversal stay out.
describe('safeRepoUrl', () => {
  it('has accepted and rejected vectors', () => {
    expect(repoVectors.some((v) => v.expected === null)).toBe(true);
    expect(repoVectors.some((v) => v.expected !== null)).toBe(true);
  });
  for (const { owner, name, expected } of repoVectors)
    it(`${expected === null ? 'rejects' : 'builds'} ${JSON.stringify([owner, name])}`, () => {
      expect(safeRepoUrl(owner, name)).toBe(expected);
    });
});
