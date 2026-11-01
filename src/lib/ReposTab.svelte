<script lang="ts">
  import Icon from './Icon.svelte';
  import { avatarLetter } from './format';
  import { fullRepo } from './model';
  import type { Repo, Snapshot } from './types';

  let {
    snapshot,
    demo,
    busy,
    query = $bindable(),
    selected = $bindable(),
    onManageInstallation,
    onRefreshAccess,
  }: {
    snapshot: Snapshot | null;
    demo: boolean;
    /** A repository mutation is running. */
    busy: boolean;
    /** Filter text; owned by the dialog so it survives tab switches. */
    query: string;
    /** Repository IDs ticked in this dialog, saved only on „Auswahl speichern“. */
    selected: string[];
    onManageInstallation: () => void;
    onRefreshAccess: () => void;
  } = $props();
  const needle = $derived(query.trim().toLowerCase());
  const browserInstallation = $derived(
    !demo &&
      !!snapshot?.accounts.some((account) =>
        account.id.startsWith('github-device-'),
      ),
  );

  function reposOf(accountId: string): Repo[] {
    return (
      snapshot?.repos.filter(
        (repo) =>
          repo.accountId === accountId &&
          fullRepo(repo).toLowerCase().includes(needle),
      ) ?? []
    );
  }
  function permissionLabel(repo: Repo) {
    return repo.permission === 'write'
      ? 'Actions · Schreibzugriff'
      : repo.permission === 'denied'
        ? 'Actions · Kein Zugriff'
        : 'Actions · Nur Lesen';
  }
  function toggle(id: string, checked: boolean) {
    selected = checked
      ? [...selected, id]
      : selected.filter((item) => item !== id);
  }
</script>

<div class="settings-intro">
  <Icon name="repo" size={19} />
  <div>
    <h3>Repositories im Überblick</h3>
    <p>Wähle, was in deinem Tray erscheint.</p>
  </div>
</div>
<label class="field settings-repo-search"
  ><span>Repositories filtern</span><input
    type="search"
    placeholder="Name oder Organisation …"
    bind:value={query}
  /></label
>
<p class="field-help">
  {selected.length} Repositories ausgewählt
</p>
<div class="repo-selection">
  {#each snapshot?.accounts ?? [] as account}<div class="selection-account">
      <span class="mini-avatar">{avatarLetter(account.login, '?')}</span
      >{account.login}<span>{account.label}</span>
    </div>
    {#each reposOf(account.id) as repo}<label class="repo-checkbox"
        ><input
          type="checkbox"
          value={repo.id}
          checked={selected.includes(repo.id)}
          onchange={(event) => toggle(repo.id, event.currentTarget.checked)}
        /><span
          ><strong>{fullRepo(repo)}</strong><small
            >{permissionLabel(repo)}</small
          ></span
        ><Icon name="repo" size={15} /></label
      >{/each}{/each}
</div>
{#if browserInstallation}
  <div class="settings-section installation-access">
    <button
      class="text-button"
      disabled={busy}
      onclick={() => onManageInstallation()}
      >Repository-Freigabe auf GitHub ändern<Icon
        name="external"
        size={14}
      /></button
    >
    <p class="field-help">
      Wähle bei der App-Installation einzelne oder alle Repositories.
      Organisationen können eine Freigabe oder aktive SSO-Sitzung verlangen.
      Autorisierung und Installation sind getrennte Schritte.
    </p>
    <button
      class="secondary-button"
      disabled={busy}
      onclick={() => onRefreshAccess()}
      >Repository-Liste aktualisieren<Icon name="refresh" size={14} /></button
    >
  </div>
{/if}
