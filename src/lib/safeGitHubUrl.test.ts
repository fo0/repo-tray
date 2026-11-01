import { describe, expect, it } from 'vitest';
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

describe('safeRepoUrl', () => {
  it('builds the page of a repository with GitHub names', () => {
    expect(safeRepoUrl('team-demo', 'sandbox-demo')).toBe(
      'https://github.com/team-demo/sandbox-demo',
    );
    expect(safeRepoUrl('handle_shortcode', 'repo.name_2')).toBe(
      'https://github.com/handle_shortcode/repo.name_2',
    );
  });
  for (const [owner, name] of [
    ['', 'repo'],
    ['owner', ''],
    ['own er', 'repo'],
    ['owner', 're/po'],
    ['owner', '..'],
    ['owner', '.'],
    ['owner', 'repo?x=1'],
    ['owner', 'repo#top'],
    ['ówner', 'repo'],
    ['a'.repeat(40), 'repo'],
    ['owner', 'r'.repeat(101)],
    // Regression vectors: a multiline regex, a looser charset or a port of
    // this check must keep rejecting line breaks, control and bidi
    // characters, userinfo, ports, backslashes and encoded traversal.
    ['owner', 'repo\n'],
    ['owner\n', 'repo'],
    ['owner', 'repo\u0000'],
    ['owner', 'repo‮'],
    ['owner', 'repo@evil.example'],
    ['owner', 'repo:443'],
    ['owner', 're\\po'],
    ['owner', '%2e%2e'],
  ])
    it(`rejects ${JSON.stringify([owner, name])}`, () => {
      expect(safeRepoUrl(owner!, name!)).toBeNull();
    });
});
