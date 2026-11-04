//! User-facing text of the browser sign-in, in the app's language.
use crate::i18n::tr;

pub(super) fn sign_in_disabled() -> &'static str {
    tr(
        "Die Browser-Anmeldung / GitHub App ist vorübergehend deaktiviert. Nutze gh CLI oder einen Token.",
        "Browser sign-in / GitHub App is temporarily disabled. Use gh CLI or a token.",
    )
}

pub(super) fn reauth() -> &'static str {
    tr(
        "Browser-Anmeldung abgelaufen oder nicht sicher erneuerbar. Melde dich erneut mit GitHub an.",
        "Browser sign-in expired or cannot be renewed safely. Sign in with GitHub again.",
    )
}

pub(super) fn invalid() -> &'static str {
    tr(
        "GitHub hat eine ungültige Anmeldeantwort geliefert.",
        "GitHub returned an invalid sign-in response.",
    )
}

/// German and English wording of [`network`].
const NETWORK: [&str; 2] = [
    "GitHub ist gerade nicht erreichbar. RepoWatch versucht es weiter, solange der Code gültig ist.",
    "GitHub is unreachable right now. RepoWatch keeps trying while the code is valid.",
];

pub(super) fn network() -> &'static str {
    tr(NETWORK[0], NETWORK[1])
}

/// Whether `message` is [`network`] in either language, so a language switch between
/// producing and checking it changes nothing.
pub(super) fn is_network(message: &str) -> bool {
    NETWORK.contains(&message)
}

pub(super) fn not_configured() -> &'static str {
    tr(
        "Browser-Anmeldung ist noch nicht eingerichtet. Die Herausgeber-App und ihre öffentliche Client-ID fehlen.",
        "Browser sign-in is not set up yet. The publisher app and its public client ID are missing.",
    )
}

pub(super) fn service_unavailable() -> &'static str {
    tr(
        "Anmeldedienst nicht verfügbar.",
        "Sign-in service unavailable.",
    )
}

pub(super) fn account_unconfirmed() -> &'static str {
    tr(
        "GitHub-Konto konnte nicht bestätigt werden. Prüfe Organisationsfreigabe und melde dich erneut an.",
        "GitHub account could not be confirmed. Check the organization approval and sign in again.",
    )
}

pub(super) fn start_failed() -> &'static str {
    tr(
        "GitHub-Anmeldung konnte nicht gestartet werden. Prüfe Herausgeberkonfiguration und Netzwerk.",
        "GitHub sign-in could not be started. Check the publisher configuration and the network.",
    )
}

pub(super) fn device_codes_unsupported() -> &'static str {
    tr(
        "GitHub-App nicht für Gerätecodes eingerichtet oder Anmeldeantwort ungültig.",
        "GitHub App not set up for device codes, or invalid sign-in response.",
    )
}

pub(super) fn app_not_set_up() -> &'static str {
    tr(
        "Die Herausgeber-App ist nicht für diese Anmeldung eingerichtet.",
        "The publisher app is not set up for this sign-in.",
    )
}

pub(super) fn ended() -> &'static str {
    tr(
        "GitHub hat die Anmeldung beendet. Starte sie neu.",
        "GitHub ended the sign-in. Start it again.",
    )
}

pub(super) fn cancelled() -> &'static str {
    tr("Anmeldung wurde abgebrochen.", "Sign-in was cancelled.")
}

pub(super) fn vault_unavailable() -> &'static str {
    crate::auth::vault_unavailable()
}

pub(super) fn not_saved() -> &'static str {
    tr(
        "Betriebssystem-Tresor nicht verfügbar. Anmeldung wurde nicht gespeichert.",
        "Operating system vault unavailable. The sign-in was not saved.",
    )
}

pub(super) fn rollback_failed() -> &'static str {
    tr(
        "Anmeldung abgebrochen; der vorherige Tresoreintrag konnte nicht wiederhergestellt werden. Verbinde das Konto erneut oder trenne es.",
        "Sign-in cancelled; the previous vault entry could not be restored. Reconnect or disconnect the account.",
    )
}

pub(super) fn delete_failed() -> &'static str {
    tr(
        "Token konnte nicht aus dem Betriebssystem-Tresor entfernt werden.",
        "Token could not be removed from the operating system vault.",
    )
}
