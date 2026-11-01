//! Release policy in addition to Tauri's mandatory installer signature verification.
//!
//! Two modes: builds with a compiled-in updater public key install signed updates in the app;
//! the standard unsigned builds only learn about a newer stable release and open its page.
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::{io::Read, time::Duration};

/// Signed updater feed. Standard unsigned releases publish no `latest.json`, so this resolves
/// to 404 until signing is introduced. A signed build then needs a dedicated feed URL that
/// only ever serves signed manifests instead of this "latest release asset" shortcut.
pub const ENDPOINT: &str = "https://github.com/fo0/repo-tray/releases/latest/download/latest.json";
/// Shown when the signed feed above yields no manifest. The updater plugin reports every
/// non-success status (404, 403, 429, 5xx) as `ReleaseNotFound`, so the text stays neutral.
pub const NO_SIGNED_FEED: &str =
    "Kein Update-Feed für signierte Updates erreichbar oder veröffentlicht.";
/// Notify mode reads public release metadata only; no token, no download.
pub const LATEST_RELEASE_API: &str = "https://api.github.com/repos/fo0/repo-tray/releases/latest";
const RELEASE_PAGE_PREFIX: &str = "https://github.com/fo0/repo-tray/releases/tag/v";
const MAX_RELEASE_BYTES: usize = 1024 * 1024;
const MAX_NOTES_CHARS: usize = 4000;
const MAX_VERSION_CHARS: usize = 48;
const CHECK_FAILED: &str =
    "Updates konnten nicht geprüft werden. Prüfe deine Verbindung und versuche es erneut.";
const RATE_LIMITED: &str = "GitHub begrenzt gerade die Update-Prüfung. Versuche es später erneut.";
const INVALID_RELEASE: &str = "Die Angaben zur neuesten Version konnten nicht gelesen werden.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateMode {
    /// A signed package is downloaded, verified and installed in the app.
    Install,
    /// Only the release page is opened; the user installs the EXE manually.
    Notify,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub mode: UpdateMode,
    pub version: String,
    pub notes: String,
    /// RFC 3339 UTC publication time, when known.
    pub date: Option<String>,
}

/// A canonical stable `MAJOR.MINOR.PATCH` (no prefix, leading zeros, pre-release or build).
fn stable_version(value: &str) -> Option<semver::Version> {
    if value.len() > MAX_VERSION_CHARS {
        return None;
    }
    semver::Version::parse(value).ok().filter(|parsed| {
        parsed.pre.is_empty() && parsed.build.is_empty() && parsed.to_string() == value
    })
}

fn newer_than(version: &semver::Version, current: &str) -> Result<bool, String> {
    let current = semver::Version::parse(current).map_err(|_| "App-Version ungültig.")?;
    Ok(*version > current)
}

pub fn validate_download_url(url: &str, version: &str) -> bool {
    stable_version(version).is_some()
        && url == format!("https://github.com/fo0/repo-tray/releases/download/v{version}/RepoTray_{version}_x64-setup.exe")
}

pub fn validate_update(url: &str, version: &str, current: &str) -> Result<(), String> {
    if !validate_download_url(url, version) {
        return Err("Das Update gehört nicht zu einem stabilen RepoTray-Release.".into());
    }
    let version = semver::Version::parse(version).map_err(|_| "Update-Version ungültig.")?;
    if !newer_than(&version, current)? {
        return Err("Das Update ist nicht neuer als die installierte Version.".into());
    }
    Ok(())
}

/// Formats a publication time as RFC 3339 UTC with second precision.
pub fn format_date(unix_seconds: i64) -> Option<String> {
    DateTime::<Utc>::from_timestamp(unix_seconds, 0)
        .map(|date| date.to_rfc3339_opts(SecondsFormat::Secs, true))
}

fn normalize_date(value: Option<&str>) -> Option<String> {
    DateTime::parse_from_rfc3339(value?)
        .ok()
        .and_then(|date| format_date(date.timestamp()))
}

fn bounded_notes(notes: Option<String>) -> String {
    let notes = notes.unwrap_or_default();
    match notes.char_indices().nth(MAX_NOTES_CHARS) {
        Some((cut, _)) => format!("{}…", notes[..cut].trim_end()),
        None => notes,
    }
}

/// The only page notify mode may open: the tag page of a validated, newer stable release.
pub fn release_page_url(version: &str, current: &str) -> Result<String, String> {
    let parsed = stable_version(version).ok_or("Release-Version ungültig.")?;
    if !newer_than(&parsed, current)? {
        return Err("Diese Version ist nicht neuer als die installierte.".into());
    }
    Ok(format!("{RELEASE_PAGE_PREFIX}{parsed}"))
}

/// Interprets `GET /repos/fo0/repo-tray/releases/latest`. `Ok(None)` means no newer stable
/// release exists; anything that cannot be trusted as a stable `v<version>` tag is an error.
pub fn parse_latest_release(
    status: u16,
    body: &[u8],
    current: &str,
) -> Result<Option<UpdateInfo>, String> {
    match status {
        200 => {}
        // GitHub answers 404 while no published, non-prerelease release exists.
        404 => return Ok(None),
        403 | 429 => return Err(RATE_LIMITED.into()),
        _ => return Err(CHECK_FAILED.into()),
    }
    if body.len() > MAX_RELEASE_BYTES {
        return Err(INVALID_RELEASE.into());
    }
    #[derive(Deserialize)]
    struct Release {
        tag_name: String,
        draft: bool,
        prerelease: bool,
        #[serde(default)]
        body: Option<String>,
        #[serde(default)]
        published_at: Option<String>,
    }
    let release: Release = serde_json::from_slice(body).map_err(|_| INVALID_RELEASE)?;
    if release.draft || release.prerelease {
        return Ok(None);
    }
    let version = release
        .tag_name
        .strip_prefix('v')
        .and_then(stable_version)
        .ok_or(INVALID_RELEASE)?;
    if !newer_than(&version, current)? {
        return Ok(None);
    }
    Ok(Some(UpdateInfo {
        mode: UpdateMode::Notify,
        version: version.to_string(),
        notes: bounded_notes(release.body),
        date: normalize_date(release.published_at.as_deref()),
    }))
}

/// Unauthenticated, blocking read of the latest public release. Same transport rules as the
/// account traffic: fixed `api.github.com` URL, no redirects, bounded body, timeouts.
pub fn fetch_latest_release(current: &str) -> Result<Option<UpdateInfo>, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("RepoTray/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| CHECK_FAILED)?;
    let response = client
        .get(LATEST_RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", crate::github::API_VERSION)
        .send()
        .map_err(|_| CHECK_FAILED)?;
    let status = response.status().as_u16();
    let mut body = Vec::new();
    response
        .take(MAX_RELEASE_BYTES as u64 + 1)
        .read_to_end(&mut body)
        .map_err(|_| CHECK_FAILED)?;
    parse_latest_release(status, &body, current)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn url(version: &str) -> String {
        format!("https://github.com/fo0/repo-tray/releases/download/v{version}/RepoTray_{version}_x64-setup.exe")
    }
    fn release(tag: &str, draft: bool, prerelease: bool) -> Vec<u8> {
        serde_json::json!({
            "tag_name": tag,
            "draft": draft,
            "prerelease": prerelease,
            "body": "Synthetic changelog",
            "published_at": "2026-11-01T09:05:42+01:00",
            "html_url": "https://github.com/fo0/repo-tray/releases/tag/ignored",
        })
        .to_string()
        .into_bytes()
    }
    #[test]
    fn stable_calendar_updates_are_newer_across_year_and_clock_changes() {
        for (version, current) in [
            ("2026.101.0", "0.1.0"),
            ("2026.1025.100", "2026.1025.59"),
            ("2027.101.0", "2026.1231.2359"),
        ] {
            assert!(validate_update(&url(version), version, current).is_ok());
            assert!(validate_update(&url(current), current, version).is_err());
            assert!(validate_update(&url(version), version, version).is_err());
        }
    }
    #[test]
    fn rejects_foreign_urls_credentials_queries_and_version_mismatches() {
        let expected = url("0.2.0");
        for candidate in [
            expected.replace("https:", "http:"),
            expected.replace("github.com", "github.com.attacker.invalid"),
            expected.replace("github.com", "token@github.com"),
            expected.replace("fo0/repo-tray", "other/repo"),
            expected.replace("v0.2.0/", "v0.3.0/"),
            format!("{expected}?token=x"),
            format!("{expected}#fragment"),
        ] {
            assert!(validate_update(&candidate, "0.2.0", "0.1.0").is_err());
        }
        for version in ["0.2.0-beta", "0.2.0+build", "../0.2.0", "garbage"] {
            assert!(validate_update(&url(version), version, "0.1.0").is_err());
        }
    }
    #[test]
    fn notify_mode_reports_only_a_newer_stable_release_tag() {
        // release.mjs: 2026-11-01T09:05Z → 2026.1101.905, midnight → minute component 0.
        let info = parse_latest_release(200, &release("v2026.1101.905", false, false), "0.1.0")
            .unwrap()
            .unwrap();
        assert_eq!(
            info,
            UpdateInfo {
                mode: UpdateMode::Notify,
                version: "2026.1101.905".into(),
                notes: "Synthetic changelog".into(),
                date: Some("2026-11-01T08:05:42Z".into()),
            }
        );
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["mode"], "notify");
        assert_eq!(json["date"], "2026-11-01T08:05:42Z");
        for (tag, current) in [
            ("v2026.1101.0", "2026.1031.2359"),
            ("v2027.101.0", "2026.1231.2359"),
            ("v2026.1025.100", "2026.1025.59"),
        ] {
            let found = parse_latest_release(200, &release(tag, false, false), current).unwrap();
            assert_eq!(found.unwrap().version, tag[1..]);
        }
        for current in ["2026.1101.905", "2026.1101.906", "2027.101.0"] {
            assert_eq!(
                parse_latest_release(200, &release("v2026.1101.905", false, false), current),
                Ok(None)
            );
        }
    }
    #[test]
    fn notify_mode_ignores_drafts_prereleases_and_missing_releases() {
        for (draft, prerelease) in [(true, false), (false, true), (true, true)] {
            let body = release("v2026.1101.905", draft, prerelease);
            assert_eq!(parse_latest_release(200, &body, "0.1.0"), Ok(None));
        }
        assert_eq!(parse_latest_release(404, b"{}", "0.1.0"), Ok(None));
    }
    #[test]
    fn notify_mode_rejects_untrusted_tags_statuses_and_bodies() {
        for tag in [
            "2026.1101.905",
            "V2026.1101.905",
            "v2026.1101.0905",
            "v02026.1101.905",
            "v2026.1101",
            "v2026.1101.905.1",
            "v2026.1101.905-rc.1",
            "v2026.1101.905+build",
            " v2026.1101.905",
            "v2026.1101.905 ",
            "v../2026.1101.905",
            "vv2026.1101.905",
            "",
        ] {
            assert!(
                parse_latest_release(200, &release(tag, false, false), "0.1.0").is_err(),
                "{tag:?} must be rejected"
            );
        }
        for status in [301, 302, 304, 401, 500, 503] {
            assert_eq!(
                parse_latest_release(status, &release("v9.0.0", false, false), "0.1.0"),
                Err(CHECK_FAILED.into())
            );
        }
        for status in [403, 429] {
            assert_eq!(
                parse_latest_release(status, b"", "0.1.0"),
                Err(RATE_LIMITED.into())
            );
        }
        let mut oversized = release("v9.0.0", false, false);
        oversized.resize(MAX_RELEASE_BYTES + 1, b' ');
        for body in [
            oversized,
            b"not json".to_vec(),
            br#"{"tag_name":"v9.0.0"}"#.to_vec(),
        ] {
            assert!(parse_latest_release(200, &body, "0.1.0").is_err());
        }
        assert!(parse_latest_release(200, &release("v9.0.0", false, false), "dev").is_err());
    }
    #[test]
    fn notify_mode_bounds_notes_and_tolerates_missing_metadata() {
        let body = serde_json::json!({
            "tag_name": "v1.0.0",
            "draft": false,
            "prerelease": false,
            "body": "ä".repeat(MAX_NOTES_CHARS + 10),
            "published_at": "not a date",
        });
        let info = parse_latest_release(200, body.to_string().as_bytes(), "0.1.0")
            .unwrap()
            .unwrap();
        assert_eq!(info.notes.chars().count(), MAX_NOTES_CHARS + 1);
        assert!(info.notes.ends_with('…'));
        assert_eq!(info.date, None);
        let body = br#"{"tag_name":"v1.0.0","draft":false,"prerelease":false,"body":null}"#;
        let info = parse_latest_release(200, body, "0.1.0").unwrap().unwrap();
        assert_eq!((info.notes.as_str(), info.date), ("", None));
    }
    #[test]
    fn release_page_is_the_exact_tag_page_of_a_newer_stable_version() {
        assert_eq!(
            release_page_url("2026.1101.905", "0.1.0").unwrap(),
            "https://github.com/fo0/repo-tray/releases/tag/v2026.1101.905"
        );
        for version in [
            "v2026.1101.905",
            "2026.1101.0905",
            "2026.1101.905-rc.1",
            "2026.1101.905/../../evil",
            "2026.1101.905?x=1",
            "2026.1101.905#x",
            "1.0.0 ",
            "",
        ] {
            assert!(release_page_url(version, "0.1.0").is_err(), "{version:?}");
        }
        for current in ["2026.1101.905", "2027.101.0"] {
            assert!(release_page_url("2026.1101.905", current).is_err());
        }
        assert!(release_page_url(&"9".repeat(MAX_VERSION_CHARS + 1), "0.1.0").is_err());
    }
    #[test]
    fn signed_update_dates_are_rfc3339_utc() {
        assert_eq!(format_date(0).as_deref(), Some("1970-01-01T00:00:00Z"));
        assert_eq!(
            format_date(1_793_523_942).as_deref(),
            Some("2026-11-01T09:05:42Z")
        );
    }
}
