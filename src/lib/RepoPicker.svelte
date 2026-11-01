<script lang="ts">
  import EmptyState, { type NextStep } from './EmptyState.svelte';
  import Icon from './Icon.svelte';
  import RepoPick from './RepoPick.svelte';
  import { avatarLetter, errorMessage } from './format';
  import { fullRepo } from './model';
  import type { Panel } from './panel.svelte';
  import { MAX_REPOS, permissionLabel } from './repoSelection.svelte';

  let {
    panel,
    connected,
    query,
    accountName,
    setup,
    onClearQuery,
  }: {
    /** Snapshot, account scope and the repository selection. */
    panel: Panel;
    /** Login of a just-connected account: its repositories come next. */
    connected: string;
    /** The panel's search, which filters the picker by name. */
    query: string;
    accountName: (accountId: string) => string;
    /** Without any connected account, the step that connects one. */
    setup: NextStep | null;
    onClearQuery: () => void;
  } = $props();

  const id = $props.id();
  const snapshot = $derived(panel.snapshot);
  const needle = $derived(query.trim().toLocaleLowerCase());
  /** Every connected account with its repositories matching the search. */
  const groups = $derived(
    (snapshot?.accounts ?? []).map((account) => ({
      account,
      repos: (snapshot?.repos ?? [])
        .filter(
          (repo) =>
            repo.accountId === account.id &&
            fullRepo(repo).toLocaleLowerCase().includes(needle),
        )
        .sort((a, b) => fullRepo(a).localeCompare(fullRepo(b))),
    })),
  );
  const matches = $derived(groups.some((group) => group.repos.length));
  const count = $derived(
    snapshot?.repos.filter((repo) => panel.selection.has(repo.id)).length ?? 0,
  );
  /** Another settings change (access refresh, disconnect) runs meanwhile. */
  const locked = $derived(panel.settingsBusy && !panel.selectionBusy);
  const browserInstallation = $derived(
    !panel.demo &&
      !!snapshot?.accounts.some((account) =>
        account.id.startsWith('github-device-'),
      ),
  );

  /** Errors land in the banner; a stale refresh is announced there already. */
  async function attempt(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (cause) {
      panel.showNotice(errorMessage(cause), 'warning');
    }
  }
</script>

{#if connected}<p class="picker-banner" role="status">
    <Icon name="check" size={15} /><span
      ><strong>{connected}</strong> ist verbunden. Wähle jetzt die Repositories, die
      in deinem Tray erscheinen sollen.</span
    >
  </p>{/if}
{#if setup}<EmptyState icon="repo" iconSize={25} {...setup} />
{:else if !matches}<EmptyState
    icon="search"
    iconSize={25}
    title="Keine passenden Repositories"
    text={needle
      ? 'Versuche einen anderen Suchbegriff.'
      : 'Für die verbundenen Konten sind noch keine Repositories freigegeben.'}
    action={needle
      ? { label: 'Suche leeren', icon: 'close', run: onClearQuery }
      : undefined}
  />
{:else}
  <p class="picker-count">
    {count} von höchstens {MAX_REPOS} Repositories im Tray
  </p>
  {#each groups as { account, repos }, index (account.id)}
    {#if repos.length || !needle}
      {@const shown = panel.showsAccount(account.id)}
      <section class="picker-group" aria-labelledby={`${id}-${index}`}>
        <h3 class="picker-account" id={`${id}-${index}`}>
          <span class="avatar" class:current={shown} aria-hidden="true"
            >{avatarLetter(account.login, '?')}</span
          ><span class="picker-login">{account.login}</span><small
            >{account.label}</small
          >
        </h3>
        {#if !shown}<p class="picker-hint">
            Erscheint in der Übersicht, sobald {accountName(account.id)} aktiv ist.
          </p>{/if}
        {#if repos.length}<ul class="pick-list">
            {#each repos as repo (repo.id)}<RepoPick
                {repo}
                meta={permissionLabel(repo)}
                inTray={panel.selection.has(repo.id)}
                busy={panel.selection.busy(repo.id)}
                disabled={locked}
                onToggle={() => void panel.selection.toggle(repo.id)}
              />{/each}
          </ul>{:else}<p class="picker-hint">
            Keine Repositories für dieses Konto freigegeben.
          </p>{/if}
      </section>
    {/if}
  {/each}
{/if}
{#if browserInstallation}
  <div class="picker-access">
    <button
      class="text-button"
      disabled={panel.settingsBusy}
      onclick={() => void attempt(panel.manageInstallation)}
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
      disabled={panel.settingsBusy}
      onclick={() => void attempt(panel.refreshAccess)}
      >Repository-Liste aktualisieren<Icon name="refresh" size={14} /></button
    >
  </div>
{/if}
<p class="picker-foot">
  <Icon name="check" size={14} />Änderungen gelten sofort – kein Speichern
  nötig.
</p>
