//! GitHub Actions run links the shell may open in the browser.
//!
//! Same rules and vectors (`fixtures/run-links.json`) as `safeGitHubUrl` in
//! `src/lib/safeGitHubUrl.ts`, so the panel shows a link exactly when the shell opens it.

use reqwest::Url;

/// The normalized link to open, or `None` unless `raw` is an HTTPS link on
/// exactly `github.com` (no credentials, port, query or fragment, not even an
/// empty `?` or `#`) with the path `/<owner>/<repo>/actions/runs/<u64>` in
/// GitHub's owner and repository charsets. Callers open the returned string,
/// never `raw`: the parser strips tabs, newlines and surrounding control
/// characters that `raw` may still carry.
pub fn canonical_run_url(raw: &str) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let segments: Vec<&str> = url.path_segments()?.collect();
    let [owner, repo, "actions", "runs", id] = segments.as_slice() else {
        return None;
    };
    (is_owner(owner) && is_repo(repo) && is_run_id(id)).then(|| url.into())
}

/// GitHub login charset, at most 39 characters.
fn is_owner(owner: &str) -> bool {
    (1..=39).contains(&owner.len())
        && owner
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
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
    use super::canonical_run_url;

    const VECTORS: &str = include_str!("../../fixtures/run-links.json");

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
