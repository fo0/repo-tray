const U64_MAX = 18446744073709551615n;
/** GitHub's login charset; logins are at most 39 characters. */
const OWNER = /^[A-Za-z0-9-]{1,39}$/;
/** GitHub's repository-name charset; names are at most 100 characters. */
const REPO = /^[A-Za-z0-9_.-]{1,100}$/;
/** A run id as written by GitHub: ASCII digits that fit a `u64`. */
const RUN_ID = /^[0-9]{1,20}$/;

/**
 * Canonical run link, or null. Same rules and vectors
 * (fixtures/run-links.json) as `canonical_run_url` in
 * src-tauri/src/run_link.rs, so the panel never shows a link the shell would
 * refuse: HTTPS on exactly `github.com` without port or credentials, no query
 * or fragment (not even an empty `?` or `#`), and exactly
 * `/<owner>/<repo>/actions/runs/<id>` with GitHub's owner and repository
 * charsets, so nothing percent-encoded survives.
 */
export function safeGitHubUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // `search` and `hash` read empty for a bare `?` or `#`; the serialization keeps them.
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    /[?#]/.test(url.href)
  )
    return null;
  const [owner, repo, actions, runs, id, ...rest] = url.pathname
    .slice(1)
    .split('/');
  if (
    rest.length > 0 ||
    !OWNER.test(owner) ||
    !REPO.test(repo ?? '') ||
    repo === '.' ||
    repo === '..' ||
    actions !== 'actions' ||
    runs !== 'runs' ||
    !RUN_ID.test(id ?? '') ||
    BigInt(id) > U64_MAX
  )
    return null;
  return url.href;
}
