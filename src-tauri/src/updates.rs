//! Private release discovery for an explicit browser download, never executable installation.
use crate::auth::SecretToken;
use serde::{Deserialize, Serialize};
use std::{io::Read, time::Duration};
pub const RELEASES: &str = "https://api.github.com/repos/fo0/repo-tray/releases/latest";
const PREFIX: &str = "https://api.github.com/repos/fo0/repo-tray/releases/assets/";
#[derive(Deserialize)]
struct Asset {
    id: u64,
    name: String,
    url: String,
    size: u64,
    browser_download_url: String,
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
    #[serde(default)]
    body: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub download_url: String,
}
pub fn validate_download_url(url: &str, version: &str) -> bool {
    semver::Version::parse(version).is_ok_and(|parsed| {
        parsed.pre.is_empty() && parsed.build.is_empty()
            && url == format!("https://github.com/fo0/repo-tray/releases/download/v{version}/RepoTray_{version}_x64-setup.exe")
    })
}
pub fn validate_asset_url(url: &str) -> bool {
    url.strip_prefix(PREFIX).is_some_and(|id| {
        !id.is_empty()
            && id.bytes().all(|b| b.is_ascii_digit())
            && id.parse::<u64>().is_ok_and(|id| id > 0)
    })
}
pub fn parse_release(bytes: &[u8], current: &str) -> Result<Option<UpdateInfo>, String> {
    let release: Release =
        serde_json::from_slice(bytes).map_err(|_| "Release-Metadaten ungültig.")?;
    if release.draft || release.prerelease || !release.tag_name.starts_with('v') {
        return Err("Kein freigegebenes stabiles Release.".into());
    }
    let version = &release.tag_name[1..];
    let parsed = semver::Version::parse(version).map_err(|_| "Release-Version ungültig.")?;
    let current = semver::Version::parse(current).map_err(|_| "App-Version ungültig.")?;
    if !parsed.pre.is_empty() || !parsed.build.is_empty() {
        return Err("Kein freigegebenes stabiles Release.".into());
    }
    let find = |name: &str| -> Result<&Asset, String> {
        let matches: Vec<_> = release.assets.iter().filter(|a| a.name == name).collect();
        if matches.len() != 1 {
            return Err("Release-Artefakte fehlen oder sind mehrdeutig.".into());
        }
        let a = matches[0];
        if a.id == 0
            || a.size == 0
            || a.url != format!("{PREFIX}{}", a.id)
            || !validate_asset_url(&a.url)
        {
            return Err("Release-Asset liegt außerhalb von RepoTray.".into());
        }
        Ok(a)
    };
    let installer_name = format!("RepoTray_{version}_x64-setup.exe");
    let installer = find(&installer_name)?;
    if !validate_download_url(&installer.browser_download_url, version) {
        return Err("Download liegt außerhalb des RepoTray-Releases.".into());
    }
    if parsed <= current {
        return Ok(None);
    }
    Ok(Some(UpdateInfo {
        version: version.into(),
        notes: release.body.unwrap_or_default(),
        download_url: installer.browser_download_url.clone(),
    }))
}
pub fn discover(token: &SecretToken, current: &str) -> Result<Option<UpdateInfo>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("RepoTray/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "Update-Dienst nicht verfügbar.")?;
    let response = token
        .with_secret(|token| {
            client
                .get(RELEASES)
                .bearer_auth(token)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", crate::github::API_VERSION)
                .send()
        })
        .map_err(|_| "Updateprüfung fehlgeschlagen. Prüfe die Verbindung.")?;
    if !response.status().is_success() {
        return Err("Kein lesbares RepoTray-Release. Der gewählte Token braucht Contents: read für fo0/repo-tray; eventuell gibt es noch kein Release.".into());
    }
    let mut bytes = vec![];
    response
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Release-Metadaten nicht lesbar.")?;
    if bytes.len() > 1024 * 1024 {
        return Err("Release-Metadaten zu groß.".into());
    }
    parse_release(&bytes, current)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn release() -> serde_json::Value {
        serde_json::json!({"tag_name":"v0.1.0","draft":false,"prerelease":false,"body":"Changes","assets":[{"id":2,"size":200,"name":"RepoTray_0.1.0_x64-setup.exe","url":format!("{PREFIX}2"),"browser_download_url":"https://github.com/fo0/repo-tray/releases/download/v0.1.0/RepoTray_0.1.0_x64-setup.exe"}]})
    }
    #[test]
    fn unsigned_release_offers_exact_browser_download_without_signature_or_feed() {
        let plan = parse_release(&serde_json::to_vec(&release()).unwrap(), "0.0.1")
            .unwrap()
            .unwrap();
        assert_eq!(plan.version, "0.1.0");
        assert_eq!(plan.notes, "Changes");
        assert!(validate_download_url(&plan.download_url, &plan.version));
        for current in ["0.1.0", "0.2.0"] {
            assert!(
                parse_release(&serde_json::to_vec(&release()).unwrap(), current)
                    .unwrap()
                    .is_none()
            );
        }
    }
    #[test]
    fn calendar_versions_are_discovered_and_ordered_across_clock_and_year_changes() {
        for version in ["2026.101.0", "2026.1031.1533", "2027.101.0"] {
            let value = release().to_string().replace("0.1.0", version);
            let plan = parse_release(value.as_bytes(), "0.0.1").unwrap().unwrap();
            assert_eq!(plan.version, version);
            assert!(validate_download_url(&plan.download_url, version));
        }
        let parse = |value| semver::Version::parse(value).unwrap();
        assert!(parse("2026.1025.100") > parse("2026.1025.59"));
        assert!(parse("2027.101.0") > parse("2026.1231.2359"));
        assert!(parse("2026.101.0") > parse("0.1.0"));
    }
    #[test]
    fn rejects_foreign_missing_duplicate_or_draft_releases() {
        for change in 0..8 {
            let mut value = release();
            match change {
                0 => value["draft"] = true.into(),
                1 => value["assets"][0]["url"] = "https://attacker.invalid/feed".into(),
                2 => {
                    value["assets"].as_array_mut().unwrap().pop();
                }
                3 => value["prerelease"] = true.into(),
                4 => value["assets"][0]["browser_download_url"] = "https://attacker.invalid/app.exe".into(),
                5 => value["assets"][0]["browser_download_url"] = "https://github.com/fo0/repo-tray/releases/download/v0.1.0/RepoTray_0.1.0_x64-setup.exe?token=x".into(),
                6 => { let duplicate = value["assets"][0].clone(); value["assets"].as_array_mut().unwrap().push(duplicate); },
                _ => value["tag_name"] = "v0.2.0-beta".into(),
            };
            assert!(parse_release(&serde_json::to_vec(&value).unwrap(), "0.0.1").is_err());
        }
    }
    #[test]
    fn token_never_belongs_in_feed_url() {
        for url in [
            format!("{PREFIX}1?access_token=x"),
            format!("{PREFIX}../1"),
            "http://api.github.com/repos/fo0/repo-tray/releases/assets/1".into(),
            format!("{PREFIX}0"),
        ] {
            assert!(!validate_asset_url(&url));
        }
    }
}
