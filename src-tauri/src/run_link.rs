//! GitHub links the shell may open in the browser: Actions runs and repository pages.
//!
//! Same rules and vectors as `src/lib/safeGitHubUrl.ts` (`fixtures/run-links.json` for
//! `safeGitHubUrl`, `fixtures/repo-links.json` for `safeRepoUrl`), so the panel shows a
//! link exactly when the shell opens it.

use reqwest::Url;

/// The normalized link to open, or `None` unless `raw` is an HTTPS link on
/// exactly `github.com` (no credentials, port, query or fragment, not even an
/// empty `?` or `#`) with the path `/<owner>/<repo>/actions/runs/<u64>` in
/// GitHub's owner and repository charsets. Callers open the returned string,
/// never `raw`: the parser strips tabs, newlines and surrounding control
/// characters that `raw` may still carry.
pub fn canonical_run_url(raw: &str) -> Option<String> {
    let url = github_url(raw)?;
    let segments: Vec<&str> = url.path_segments()?.collect();
    let [owner, repo, "actions", "runs", id] = segments.as_slice() else {
        return None;
    };
    (is_owner(owner) && is_repo(repo) && is_run_id(id)).then(|| url.into())
}

/// The normalized repository page to open, or `None` unless `raw` passes the same
/// URL rules as [`canonical_run_url`] with the path exactly `/<owner>/<repo>` (no
/// trailing slash). Callers open the returned string, never `raw`.
pub fn canonical_repo_url(raw: &str) -> Option<String> {
    let url = github_url(raw)?;
    let segments: Vec<&str> = url.path_segments()?.collect();
    let [owner, repo] = segments.as_slice() else {
        return None;
    };
    (is_owner(owner) && is_repo(repo)).then(|| url.into())
}

/// HTTPS on exactly `github.com`: no credentials, port, query or fragment.
fn github_url(raw: &str) -> Option<Url> {
    let url = Url::parse(raw).ok()?;
    (url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none())
    .then_some(url)
}

/// GitHub login charset, at most 39 characters. `_` is allowed: Enterprise Managed Users
/// logins look like `handle_shortcode` and can own repositories.
fn is_owner(owner: &str) -> bool {
    (1..=39).contains(&owner.len())
        && owner
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

/// GitHub repository-name charset, at most 100 characters, never `.` or `..`.
fn is_repo(repo: &str) -> bool {
    (1..=100).contains(&repo.len())
        && repo != "."
        && repo != ".."
        && repo
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

/// ASCII digits only (`u64::from_str` would also take a leading `+`).
fn is_run_id(id: &str) -> bool {
    (1..=20).contains(&id.len())
        && id.bytes().all(|byte| byte.is_ascii_digit())
        && id.parse::<u64>().is_ok()
}

#[cfg(test)]
mod tests {
    use super::{canonical_repo_url, canonical_run_url};

    const VECTORS: &str = include_str!("../../fixtures/run-links.json");
    const REPO_VECTORS: &str = include_str!("../../fixtures/repo-links.json");

    #[derive(serde::Deserialize)]
    struct RepoVector {
        owner: String,
        name: String,
        expected: Option<String>,
    }

    /// The panel builds `https://github.com/<owner>/<name>` (`safeRepoUrl`); the shell
    /// opens exactly that string when the panel offers it, and never another one.
    #[test]
    fn opens_exactly_the_repository_pages_the_panel_builds() {
        let vectors: Vec<RepoVector> = serde_json::from_str(REPO_VECTORS).expect("valid vectors");
        assert!(vectors.iter().any(|vector| vector.expected.is_none()));
        assert!(vectors.iter().any(|vector| vector.expected.is_some()));
        for vector in vectors {
            let built = format!("https://github.com/{}/{}", vector.owner, vector.name);
            assert_eq!(
                canonical_repo_url(&built).filter(|url| *url == built),
                vector.expected,
                "input {built:?}"
            );
        }
    }

    #[test]
    fn rejects_every_other_repository_link() {
        for raw in [
            "http://github.com/a/b",
            "https://www.github.com/a/b",
            "https://github.com:8443/a/b",
            "https://user@github.com/a/b",
            "https://github.com/a/b?tab=readme",
            "https://github.com/a/b#readme",
            "https://github.com/a/b?",
            "https://github.com/a/b/",
            "https://github.com/a",
            "https://github.com/a/b/actions",
            "https://github.com/a/b/actions/runs/1",
            "https://github.com/a/..",
            "javascript:alert(1)",
        ] {
            assert_eq!(canonical_repo_url(raw), None, "input {raw:?}");
        }
        // A run link is no repository page and the other way round.
        assert_eq!(canonical_run_url("https://github.com/a/b"), None);
        assert_eq!(
            canonical_repo_url("\t https://GitHub.com:443/a/b\u{0}").as_deref(),
            Some("https://github.com/a/b")
        );
    }

    #[derive(serde::Deserialize)]
    struct Vector {
        input: String,
        expected: Option<String>,
    }

    #[test]
    fn matches_the_shared_panel_vectors() {
        let vectors: Vec<Vector> = serde_json::from_str(VECTORS).expect("valid vectors");
        assert!(vectors.iter().any(|vector| vector.expected.is_none()));
        assert!(vectors.iter().any(|vector| vector.expected.is_some()));
        for vector in vectors {
            assert_eq!(
                canonical_run_url(&vector.input),
                vector.expected,
                "input {:?}",
                vector.input
            );
        }
    }

    #[test]
    fn returns_the_normalized_string_not_the_raw_input() {
        let raw = "\t https://github.com/a/b/actions/ru\nns/1\u{0}";
        let canonical = canonical_run_url(raw).expect("a run link");
        assert_eq!(canonical, "https://github.com/a/b/actions/runs/1");
        assert_ne!(canonical, raw);
    }
}
