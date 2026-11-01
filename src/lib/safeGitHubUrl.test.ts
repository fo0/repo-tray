import { describe, expect, it } from 'vitest';
import { safeGitHubUrl } from './model';

describe('safeGitHubUrl', () => {
  // Parity with `open_run` in src-tauri/src/desktop.rs: the panel shows a run
  // link only when the shell would open it.
  const run = 'https://github.com/demo-dev/example/actions/runs/123';
  const runWithId = (id: string) => `https://github.com/a/b/actions/runs/${id}`;
  it('permits only exact HTTPS GitHub Actions run links', () => {
    expect(safeGitHubUrl(run)).toBe(run);
    for (const url of [
      '',
      'javascript:alert(1)',
      'https://github.com.evil.test/a/b/actions/runs/123',
      'https://user:password@github.com/a/b/actions/runs/123',
      'https://user@github.com/a/b/actions/runs/123',
      'http://github.com/a/b/actions/runs/123',
      'https://github.com/a/b/settings',
      'https://github.com:444/a/b/actions/runs/123',
      'https://api.github.com/a/b/actions/runs/123',
      'https://github.com./a/b/actions/runs/123',
    ])
      expect(safeGitHubUrl(url)).toBeNull();
  });
  it('rejects queries, fragments and a trailing slash like open_run', () => {
    for (const suffix of [
      '?check_suite_focus=true',
      '?',
      '#summary',
      '#',
      '/',
      '/attempts/1',
    ])
      expect(safeGitHubUrl(run + suffix)).toBeNull();
  });
  it('requires exactly owner, repository, actions, runs and a u64 id', () => {
    for (const url of [
      'https://github.com/a/actions/runs/123',
      'https://github.com/a/b/c/actions/runs/123',
      'https://github.com/a/b/Actions/runs/123',
      'https://github.com/a/b/actions/run/123',
    ])
      expect(safeGitHubUrl(url)).toBeNull();
    for (const id of ['', '-1', '1e3', '12a', '+', '18446744073709551616'])
      expect(safeGitHubUrl(runWithId(id))).toBeNull();
    // Rust's `u64::from_str` accepts a leading `+`, leading zeros and the maximum.
    for (const id of ['+7', '007', '18446744073709551615'])
      expect(safeGitHubUrl(runWithId(id))).toBe(runWithId(id));
  });
  it('normalizes like the URL parser in the shell', () => {
    expect(safeGitHubUrl('https://GitHub.com:443/a/b/actions/runs/1')).toBe(
      runWithId('1'),
    );
    expect(safeGitHubUrl('https://github.com/x/../a/b/actions/runs/1')).toBe(
      runWithId('1'),
    );
  });
});
