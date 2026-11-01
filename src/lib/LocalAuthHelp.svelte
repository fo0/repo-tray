<!-- Troubleshooting for the local gh sign-in; static text only. -->
<details class="local-auth-help">
  <summary>gh wird nicht erkannt oder du bist unsicher?</summary>
  <p>
    Git und GitHub CLI (gh) sind verschiedene Programme. Eine Git-/SSH-Anmeldung
    allein kann RepoTray nicht für die GitHub-API nutzen.
  </p>
  <ol>
    <li>Prüfe im Terminal <code>gh --version</code>.</li>
    <li>
      Prüfe deine Anmeldung mit <code>gh auth status --hostname github.com</code
      >.
    </li>
    <li>
      Falls du noch nicht angemeldet bist: <code
        >gh auth login --hostname github.com</code
      >.
    </li>
    <li>
      Starte RepoTray nach einer neuen gh-Installation neu und klicke hier auf
      „Lokale Anmeldungen prüfen“.
    </li>
  </ol>
  <p>
    Erkannte gh-Konten werden erst nach deiner Bestätigung mit RepoTray
    verbunden.
  </p>
</details>

<style>
  .local-auth-help {
    margin-top: 14px;
    font-size: var(--font-size-meta);
    line-height: 1.65;
    color: #a9bd98;
  }
  .local-auth-help summary {
    cursor: pointer;
  }
  .local-auth-help ol {
    padding-left: 18px;
  }
  .local-auth-help code {
    overflow-wrap: anywhere;
  }
</style>
