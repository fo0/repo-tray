//! User-facing text of the local account discovery, in the app's language.
use crate::i18n::tr;

pub(super) fn failed() -> &'static str {
    tr(
        "gh CLI konnte nicht geprüft werden. Prüfe im Terminal mit gh auth status, ob du bei github.com angemeldet bist; prüfe auch Verbindung und gh-Version.",
        "gh CLI could not be checked. Run gh auth status in a terminal to check that you are signed in to github.com; also check the connection and the gh version.",
    )
}

pub(super) fn cancelled() -> &'static str {
    tr(
        "Lokale Prüfung wurde abgebrochen.",
        "Local check was cancelled.",
    )
}

pub(super) fn config_dir_relative() -> &'static str {
    tr(
        "GH_CONFIG_DIR muss ein absoluter Pfad sein. Prüfe die gh-Konfiguration.",
        "GH_CONFIG_DIR must be an absolute path. Check the gh configuration.",
    )
}

pub(super) fn timed_out() -> &'static str {
    tr(
        "Zeitlimit bei lokaler Quelle erreicht.",
        "Local source timed out.",
    )
}

pub(super) fn gh_found() -> &'static str {
    tr(
        "gh CLI gefunden. Erkennung verbindet noch kein Konto mit RepoWatch.",
        "gh CLI found. Discovery does not connect an account to RepoWatch yet.",
    )
}

pub(super) fn gh_legacy() -> &'static str {
    tr(
        "Diese gh-Version zeigt nur das dort aktive Konto. Für die Auswahl aller gespeicherten gh-Konten aktualisiere die GitHub CLI.",
        "This gh version shows only its active account. Update the GitHub CLI to choose from all stored gh accounts.",
    )
}

pub(super) fn gh_no_accounts() -> &'static str {
    tr(
        "gh CLI: keine gespeicherte GitHub.com-Anmeldung gefunden.",
        "gh CLI: no stored GitHub.com sign-in found.",
    )
}

/// The panel recognizes this notice by its prefix: „gh CLI nicht“ or "gh CLI not found".
pub(super) fn gh_missing() -> &'static str {
    tr(
        "gh CLI nicht gefunden. Installiere GitHub CLI (gh), starte RepoWatch danach neu und prüfe im Terminal gh auth status. Git allein reicht nicht.",
        "gh CLI not found. Install GitHub CLI (gh), then restart RepoWatch and run gh auth status in a terminal. Git alone is not enough.",
    )
}

pub(super) fn gcm_account_detail() -> &'static str {
    tr(
        "Git Credential Manager: gespeichertes Git-Konto; API-Übernahme hier nicht unterstützt.",
        "Git Credential Manager: stored Git account; API import is not supported here.",
    )
}

pub(super) fn gcm_actions_read() -> &'static str {
    tr(
        "Git-Anmeldung belegt keine API-Rechte für Workflows.",
        "A Git sign-in proves no API permissions for workflows.",
    )
}

pub(super) fn gcm_actions_write() -> &'static str {
    tr(
        "Workflows starten: nicht nachgewiesen.",
        "Start workflows: not proven.",
    )
}

pub(super) fn gcm_no_names() -> &'static str {
    tr(
        "GCM erkannt; keine lesbaren Kontonamen verfügbar. Keine API-Anmeldung nachgewiesen. Nutze gh CLI oder einen API-Token.",
        "GCM detected; no readable account names available. No API sign-in proven. Use gh CLI or an API token.",
    )
}

pub(super) fn gcm_names() -> &'static str {
    tr(
        "GCM erkannt. Nur Kontonamen geprüft; Git-Credentials werden nicht exportiert. Nutze gh CLI oder einen API-Token.",
        "GCM detected. Only account names checked; Git credentials are not exported. Use gh CLI or an API token.",
    )
}

pub(super) fn gcm_list_unavailable() -> &'static str {
    tr(
        "GCM erkannt; Kontoliste nicht verfügbar. Keine API-Anmeldung nachgewiesen.",
        "GCM detected; account list unavailable. No API sign-in proven.",
    )
}

pub(super) fn gcm_missing() -> &'static str {
    tr(
        "Git Credential Manager: an unterstützten Installationsorten nicht gefunden.",
        "Git Credential Manager: not found in supported install locations.",
    )
}

pub(super) fn git_found() -> &'static str {
    tr(
        "Git erkannt. Binary, Remote und SSH-Anmeldung belegen keine GitHub-API-Anmeldung.",
        "Git detected. Binary, remote and SSH sign-in prove no GitHub API sign-in.",
    )
}

pub(super) fn git_missing() -> &'static str {
    tr(
        "Git: an unterstützten Installationsorten nicht gefunden. Git allein ist keine API-Anmeldequelle.",
        "Git: not found in supported install locations. Git alone is no API sign-in source.",
    )
}

pub(super) fn invalid_login() -> &'static str {
    tr(
        "Lokales Konto ungültig. Suche erneut nach gh-Konten und wähle eines aus der Liste.",
        "Invalid local account. Search for gh accounts again and choose one from the list.",
    )
}

pub(super) fn selection_gone() -> &'static str {
    tr(
        "Gewählte lokale Anmeldung ist nicht mehr verfügbar. Prüfe die lokalen Anmeldungen erneut.",
        "The chosen local sign-in is no longer available. Check the local sign-ins again.",
    )
}

pub(super) fn no_safe_selection() -> &'static str {
    tr(
        "Diese gh-Version unterstützt keine sichere Kontoauswahl. Aktualisiere die GitHub CLI.",
        "This gh version does not support safe account selection. Update the GitHub CLI.",
    )
}

pub(super) fn gh_status_incompatible() -> &'static str {
    tr(
        "Diese gh-Version stellt keinen kompatiblen Kontostatus bereit. Aktualisiere die GitHub CLI.",
        "This gh version provides no compatible account status. Update the GitHub CLI.",
    )
}

pub(super) fn gh_active_confirmed() -> &'static str {
    tr(
        "Aktives gh-Konto über GitHub bestätigt. Noch nicht mit RepoWatch verbunden.",
        "Active gh account confirmed via GitHub. Not connected to RepoWatch yet.",
    )
}

pub(super) fn scopes_unreadable() -> &'static str {
    tr(
        "Scopes nicht auslesbar; Lesezugriff auf Workflows pro Repository ungeprüft.",
        "Scopes unreadable; read access to workflows unchecked per repository.",
    )
}

pub(super) fn start_unchecked() -> &'static str {
    tr(
        "Workflows starten: pro Repository ungeprüft; kein Workflow wurde zum Prüfen gestartet.",
        "Start workflows: unchecked per repository; no workflow was started to check.",
    )
}

pub(super) fn api_sign_in_confirmed() -> &'static str {
    tr(
        "GitHub-API-Anmeldung bestätigt · bevorzugte Quelle",
        "GitHub API sign-in confirmed · preferred source",
    )
}

pub(super) fn sign_in_invalid() -> &'static str {
    tr(
        "Anmeldung ungültig, abgelaufen oder keine gespeicherte lokale Anmeldung",
        "Sign-in invalid, expired or no stored local sign-in",
    )
}

pub(super) fn scope_repo_present() -> &'static str {
    tr(
        "Scope repo vorhanden; private Workflows grundsätzlich abgedeckt. Repository-/Org-Zugriff noch ungeprüft.",
        "Scope repo present; private workflows covered in principle. Repository/org access still unchecked.",
    )
}

pub(super) fn scope_repo_missing() -> &'static str {
    tr(
        "Scope repo fehlt; Zugriff auf private Workflows nicht belegt. Feinere Rechte pro Repository ungeprüft.",
        "Scope repo missing; access to private workflows not proven. Finer permissions per repository unchecked.",
    )
}
