//! Release policy in addition to Tauri's mandatory installer signature verification.
use serde::Serialize;

pub const ENDPOINT: &str = "https://github.com/fo0/repo-tray/releases/latest/download/latest.json";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
}

pub fn validate_download_url(url: &str, version: &str) -> bool {
    semver::Version::parse(version).is_ok_and(|parsed| {
        parsed.pre.is_empty() && parsed.build.is_empty()
            && url == format!("https://github.com/fo0/repo-tray/releases/download/v{version}/RepoTray_{version}_x64-setup.exe")
    })
}

pub fn validate_update(url: &str, version: &str, current: &str) -> Result<(), String> {
    if !validate_download_url(url, version) {
        return Err("Das Update gehört nicht zu einem stabilen RepoTray-Release.".into());
    }
    let version = semver::Version::parse(version).map_err(|_| "Update-Version ungültig.")?;
    let current = semver::Version::parse(current).map_err(|_| "App-Version ungültig.")?;
    if version <= current {
        return Err("Das Update ist nicht neuer als die installierte Version.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn url(version: &str) -> String {
        format!("https://github.com/fo0/repo-tray/releases/download/v{version}/RepoTray_{version}_x64-setup.exe")
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
}
