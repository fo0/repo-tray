//! Server-free GitHub App device authorization. Only public status crosses IPC.
use crate::auth::{
    CredentialError, DeviceAuthorization, DevicePollResult, NativeKeyring, SecretToken,
};
use serde::{Deserialize, Serialize};
use std::{io::Read, sync::Mutex, time::Duration};

// Temporarily paused until the publisher is ready to support GitHub App sign-in.
// Existing stored browser credentials keep their normal lifecycle.
pub const SIGN_IN_ENABLED: bool = false;
pub fn ensure_sign_in_enabled() -> Result<(), String> {
    if SIGN_IN_ENABLED {
        Ok(())
    } else {
        Err("Die Browser-Anmeldung / GitHub App ist vorübergehend deaktiviert. Nutze gh CLI oder einen Token.".into())
    }
}
pub const VERIFY_URL: &str = "https://github.com/login/device";
const REAUTH: &str =
    "Browser-Anmeldung abgelaufen oder nicht sicher erneuerbar. Melde dich erneut mit GitHub an.";
const INVALID: &str = "GitHub hat eine ungültige Anmeldeantwort geliefert.";
const NETWORK: &str =
    "GitHub ist gerade nicht erreichbar. RepoTray versucht es weiter, solange der Code gültig ist.";
// Serialize entire read/refresh/replace/delete transactions across all native callers.
static CREDENTIALS: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserConfig {
    pub configured: bool,
}
pub fn config() -> BrowserConfig {
    BrowserConfig {
        configured: SIGN_IN_ENABLED && publisher().is_ok(),
    }
}
pub fn publisher() -> Result<(&'static str, &'static str), String> {
    let id = option_env!("REPOTRAY_GITHUB_CLIENT_ID").unwrap_or("");
    let slug = option_env!("REPOTRAY_GITHUB_APP_SLUG").unwrap_or("");
    validate_publisher(id, slug)?;
    Ok((id, slug))
}
fn validate_publisher(id: &str, slug: &str) -> Result<(), String> {
    if !id.starts_with("Iv")
        || id.len() > 80
        || id.len() < 8
        || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.')
        || slug.is_empty()
        || slug.len() > 100
        || !slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("Browser-Anmeldung ist noch nicht eingerichtet. Die Herausgeber-App und ihre öffentliche Client-ID fehlen.".into());
    }
    Ok(())
}
pub fn installation_url() -> Result<String, String> {
    let (_, slug) = publisher()?;
    Ok(format!("https://github.com/apps/{slug}/installations/new"))
}
pub fn is_browser_account(id: &str) -> bool {
    id.starts_with("github-device-")
}
pub fn account_id(user_id: u64) -> String {
    format!("github-device-{user_id}")
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum OAuthEndpoint {
    DeviceCode,
    AccessToken,
}
impl OAuthEndpoint {
    fn url(self) -> &'static str {
        match self {
            Self::DeviceCode => "https://github.com/login/device/code",
            Self::AccessToken => "https://github.com/login/oauth/access_token",
        }
    }
}
// Never derive Debug/Serialize: response bodies and forms may contain secrets.
pub struct OAuthResponse {
    pub status: u16,
    pub body: Vec<u8>,
}
impl Drop for OAuthResponse {
    fn drop(&mut self) {
        self.body.fill(0);
        std::hint::black_box(&mut self.body);
    }
}
pub trait OAuthTransport {
    fn post(
        &mut self,
        endpoint: OAuthEndpoint,
        form: &[(&str, &str)],
    ) -> Result<OAuthResponse, String>;
    fn identity(&mut self, token: &SecretToken) -> Result<(u64, String), String>;
}
pub struct NativeOAuthTransport {
    client: reqwest::blocking::Client,
}
impl NativeOAuthTransport {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(concat!("RepoTray/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|_| "Anmeldedienst nicht verfügbar.")?,
        })
    }
    fn response(response: reqwest::blocking::Response) -> Result<OAuthResponse, String> {
        let status = response.status().as_u16();
        let mut result = OAuthResponse {
            status,
            body: vec![],
        };
        response
            .take(32 * 1024 + 1)
            .read_to_end(&mut result.body)
            .map_err(|_| NETWORK)?;
        if result.body.len() > 32 * 1024 {
            return Err(INVALID.into());
        }
        Ok(result)
    }
}
impl OAuthTransport for NativeOAuthTransport {
    fn post(
        &mut self,
        endpoint: OAuthEndpoint,
        form: &[(&str, &str)],
    ) -> Result<OAuthResponse, String> {
        // A closed enum adds exactly two github.com endpoints; REST policy stays api.github.com only.
        let response = self
            .client
            .post(endpoint.url())
            .header("Accept", "application/json")
            .form(form)
            .send()
            .map_err(|_| NETWORK)?;
        Self::response(response)
    }
    fn identity(&mut self, token: &SecretToken) -> Result<(u64, String), String> {
        let request = self
            .client
            .get("https://api.github.com/user")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", crate::github::API_VERSION);
        let response = token
            .with_secret(|v| request.bearer_auth(v))
            .send()
            .map_err(|_| NETWORK)?;
        let response = Self::response(response)?;
        if response.status != 200 {
            return Err("GitHub-Konto konnte nicht bestätigt werden. Prüfe Organisationsfreigabe und melde dich erneut an.".into());
        }
        #[derive(Deserialize)]
        struct User {
            id: u64,
            login: String,
        }
        let user: User = serde_json::from_slice(&response.body).map_err(|_| INVALID)?;
        if user.id == 0
            || user.login.is_empty()
            || user.login.len() > 100
            || !user
                .login
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err(INVALID.into());
        }
        Ok((user.id, user.login))
    }
}

#[derive(Deserialize)]
struct WireTokens {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    refresh_token_expires_in: u64,
    token_type: String,
}
impl Drop for WireTokens {
    fn drop(&mut self) {
        wipe_string(&mut self.access_token);
        wipe_string(&mut self.refresh_token);
    }
}
pub struct BrowserTokens {
    pub access: SecretToken,
    pub refresh: SecretToken,
    pub expires_at: u64,
    pub refresh_expires_at: u64,
}
fn wipe_string(value: &mut String) {
    let mut bytes = std::mem::take(value).into_bytes();
    bytes.fill(0);
    std::hint::black_box(&mut bytes);
}
fn valid_secret(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 512
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}
fn tokens(response: &OAuthResponse, now: u64) -> Result<BrowserTokens, String> {
    if response.status != 200 {
        return Err(INVALID.into());
    }
    let mut wire: WireTokens = serde_json::from_slice(&response.body).map_err(|_| INVALID)?;
    if !valid_secret(&wire.access_token)
        || !valid_secret(&wire.refresh_token)
        || !wire.token_type.eq_ignore_ascii_case("bearer")
        || wire.expires_in < 60
        || wire.expires_in > 86400
        || wire.refresh_token_expires_in <= wire.expires_in
        || wire.refresh_token_expires_in > 366 * 86400
    {
        return Err(INVALID.into());
    }
    Ok(BrowserTokens {
        access: SecretToken::new(std::mem::take(&mut wire.access_token)),
        refresh: SecretToken::new(std::mem::take(&mut wire.refresh_token)),
        expires_at: now.saturating_add(wire.expires_in),
        refresh_expires_at: now.saturating_add(wire.refresh_token_expires_in),
    })
}
pub fn begin(
    transport: &mut impl OAuthTransport,
    client_id: &str,
) -> Result<DeviceAuthorization, String> {
    let response = transport.post(
        OAuthEndpoint::DeviceCode,
        &[("client_id", client_id), ("scope", "offline_access")],
    )?;
    #[derive(Deserialize)]
    struct Wire {
        device_code: String,
        user_code: String,
        verification_uri: String,
        expires_in: u64,
        interval: u64,
    }
    if response.status != 200 {
        return Err("GitHub-Anmeldung konnte nicht gestartet werden. Prüfe Herausgeberkonfiguration und Netzwerk.".into());
    }
    let wire: Wire = serde_json::from_slice(&response.body).map_err(|_| {
        "GitHub-App nicht für Gerätecodes eingerichtet oder Anmeldeantwort ungültig."
    })?;
    let device_code = SecretToken::new(wire.device_code);
    if !device_code.with_secret(valid_secret) || wire.verification_uri != VERIFY_URL {
        return Err(INVALID.into());
    }
    Ok(DeviceAuthorization {
        device_code,
        user_code: wire.user_code,
        verification_uri: wire.verification_uri,
        expires_in: wire.expires_in,
        interval: wire.interval,
    })
}
pub enum PollOutcome {
    Status(DevicePollResult),
    Tokens(BrowserTokens),
}
pub fn poll(
    transport: &mut impl OAuthTransport,
    client_id: &str,
    code: &SecretToken,
    now: u64,
) -> Result<PollOutcome, String> {
    let response = code.with_secret(|code| {
        transport.post(
            OAuthEndpoint::AccessToken,
            &[
                ("client_id", client_id),
                ("device_code", code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ],
        )
    })?;
    if response.status >= 500 || response.status == 429 {
        return Err(NETWORK.into());
    }
    #[derive(Deserialize)]
    struct ErrorBody {
        error: Option<String>,
    }
    let error: ErrorBody = serde_json::from_slice(&response.body).map_err(|_| INVALID)?;
    if let Some(error) = error.error {
        let status = match error.as_str() {
            "authorization_pending" => DevicePollResult::AuthorizationPending,
            "slow_down" => DevicePollResult::SlowDown,
            "access_denied" => DevicePollResult::AccessDenied,
            "expired_token" | "token_expired" => DevicePollResult::ExpiredToken,
            "device_flow_disabled" | "incorrect_client_credentials" => {
                return Err(
                    "Die Herausgeber-App ist nicht für diese Anmeldung eingerichtet.".into(),
                )
            }
            _ => return Err("GitHub hat die Anmeldung beendet. Starte sie neu.".into()),
        };
        return Ok(PollOutcome::Status(status));
    }
    Ok(PollOutcome::Tokens(tokens(&response, now)?))
}

// Access + refresh + rotation marker are one OS-vault value. No metadata cache contains them.
pub struct BrowserCredential {
    pub tokens: BrowserTokens,
    pub client_id: String,
    pub user_id: u64,
    pub rotation_pending: bool,
}
impl BrowserCredential {
    pub fn encode(&self) -> Result<SecretToken, String> {
        #[derive(Serialize)]
        struct Record<'a> {
            access_token: &'a str,
            refresh_token: &'a str,
            client_id: &'a str,
            user_id: u64,
            expires_at: u64,
            refresh_expires_at: u64,
            rotation_pending: bool,
        }
        self.tokens.access.with_secret(|access| {
            self.tokens.refresh.with_secret(|refresh| {
                serde_json::to_string(&Record {
                    access_token: access,
                    refresh_token: refresh,
                    client_id: &self.client_id,
                    user_id: self.user_id,
                    expires_at: self.tokens.expires_at,
                    refresh_expires_at: self.tokens.refresh_expires_at,
                    rotation_pending: self.rotation_pending,
                })
                .map(SecretToken::new)
                .map_err(|_| INVALID.into())
            })
        })
    }
    fn decode(secret: &SecretToken) -> Result<Self, String> {
        #[derive(Deserialize)]
        struct Record {
            access_token: String,
            refresh_token: String,
            client_id: String,
            user_id: u64,
            expires_at: u64,
            refresh_expires_at: u64,
            rotation_pending: bool,
        }
        impl Drop for Record {
            fn drop(&mut self) {
                wipe_string(&mut self.access_token);
                wipe_string(&mut self.refresh_token);
            }
        }
        let mut r: Record = secret
            .with_secret(|s| serde_json::from_str(s))
            .map_err(|_| REAUTH)?;
        if !valid_secret(&r.access_token) || !valid_secret(&r.refresh_token) || r.user_id == 0 {
            return Err(REAUTH.into());
        }
        Ok(Self {
            tokens: BrowserTokens {
                access: SecretToken::new(std::mem::take(&mut r.access_token)),
                refresh: SecretToken::new(std::mem::take(&mut r.refresh_token)),
                expires_at: r.expires_at,
                refresh_expires_at: r.refresh_expires_at,
            },
            client_id: r.client_id.clone(),
            user_id: r.user_id,
            rotation_pending: r.rotation_pending,
        })
    }
}
pub fn access_token(
    keyring: &dyn NativeKeyring,
    account: &str,
    transport: &mut impl OAuthTransport,
    now: u64,
) -> Result<SecretToken, CredentialError> {
    let _guard = CREDENTIALS.lock().map_err(|_| REAUTH)?;
    let stored = keyring
        .read_token(account)
        .map_err(|_| CredentialError::VaultUnavailable)?
        .ok_or(CredentialError::Missing)?;
    if !is_browser_account(account) {
        return Ok(stored);
    }
    let credential = BrowserCredential::decode(&stored)?;
    if account_id(credential.user_id) != account || credential.rotation_pending {
        return Err(REAUTH.into());
    }
    if now.saturating_add(60) < credential.tokens.expires_at {
        return Ok(credential.tokens.access);
    }
    if now.saturating_add(60) >= credential.tokens.refresh_expires_at {
        return Err(REAUTH.into());
    }
    let (id, _) = publisher()?;
    if credential.client_id != id {
        return Err(REAUTH.into());
    }
    Ok(rotate(keyring, account, transport, credential, now)?)
}
/// Commit only while the originating auth attempt still owns the result. The check
/// after a potentially blocking vault write is the commit point; cancellation that
/// wins before it restores the old entry while all other writers are excluded.
pub fn commit_credential(
    keyring: &dyn NativeKeyring,
    account: &str,
    credential: &SecretToken,
    still_current: impl Fn() -> bool,
) -> Result<(), String> {
    let _guard = CREDENTIALS.lock().map_err(|_| REAUTH)?;
    if !still_current() {
        return Err("Anmeldung wurde abgebrochen.".into());
    }
    let previous = keyring
        .read_token(account)
        .map_err(|_| "Betriebssystem-Tresor nicht verfügbar.")?;
    keyring
        .write_token(account, credential)
        .map_err(|_| "Betriebssystem-Tresor nicht verfügbar. Anmeldung wurde nicht gespeichert.")?;
    if !still_current() {
        let rollback = if let Some(previous) = previous {
            keyring.write_token(account, &previous)
        } else {
            keyring.delete_token(account)
        };
        rollback.map_err(|_| "Anmeldung abgebrochen; der vorherige Tresoreintrag konnte nicht wiederhergestellt werden. Verbinde das Konto erneut oder trenne es.")?;
        return Err("Anmeldung wurde abgebrochen.".into());
    }
    Ok(())
}
/// A refresh already in progress finishes before deletion; it can never recreate
/// a credential after this operation completes. New sign-ins use the same lock.
pub fn disconnect_credential(keyring: &dyn NativeKeyring, account: &str) -> Result<(), String> {
    let _guard = CREDENTIALS.lock().map_err(|_| REAUTH)?;
    keyring
        .delete_token(account)
        .map_err(|_| "Token konnte nicht aus dem Betriebssystem-Tresor entfernt werden.".into())
}
fn rotate(
    keyring: &dyn NativeKeyring,
    account: &str,
    transport: &mut impl OAuthTransport,
    mut credential: BrowserCredential,
    now: u64,
) -> Result<SecretToken, String> {
    // Persist intent before the single-use request. A lost response / crash must not reuse the old refresh token.
    credential.rotation_pending = true;
    keyring
        .write_token(account, &credential.encode()?)
        .map_err(|_| REAUTH)?;
    let response = credential
        .tokens
        .refresh
        .with_secret(|refresh| {
            transport.post(
                OAuthEndpoint::AccessToken,
                &[
                    ("client_id", &credential.client_id),
                    ("grant_type", "refresh_token"),
                    ("refresh_token", refresh),
                ],
            )
        })
        .map_err(|_| REAUTH)?;
    let replacement = tokens(&response, now).map_err(|_| REAUTH)?;
    let (id, _) = transport
        .identity(&replacement.access)
        .map_err(|_| REAUTH)?;
    if id != credential.user_id {
        return Err(REAUTH.into());
    }
    credential.tokens = replacement;
    credential.rotation_pending = false;
    keyring
        .write_token(account, &credential.encode()?)
        .map_err(|_| REAUTH)?;
    Ok(credential.tokens.access)
}

pub fn is_network_error(message: &str) -> bool {
    message == NETWORK
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod transaction_race_tests;
