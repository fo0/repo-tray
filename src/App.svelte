<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ActivityView from './lib/ActivityView.svelte';
  import AppFooter from './lib/AppFooter.svelte';
  import AppHeader from './lib/AppHeader.svelte';
  import ConnectPanel from './lib/ConnectPanel.svelte';
  import DispatchDialog, {
    type DispatchSeed,
  } from './lib/DispatchDialog.svelte';
  import EmptyState from './lib/EmptyState.svelte';
  import LaunchView from './lib/LaunchView.svelte';
  import Modal from './lib/Modal.svelte';
  import NativeConnect from './lib/NativeConnect.svelte';
  import NoticeBanner from './lib/NoticeBanner.svelte';
  import RepositoriesView from './lib/RepositoriesView.svelte';
  import SearchField from './lib/SearchField.svelte';
  import SettingsDialog, {
    type SettingsTab,
  } from './lib/SettingsDialog.svelte';
  import StatusBanners from './lib/StatusBanners.svelte';
  import Toolbar from './lib/Toolbar.svelte';
  import ViewTabs, { type ViewTab } from './lib/ViewTabs.svelte';
  import appPackage from '../package.json';
  import { bridge, native, observeSnapshots } from './lib/bridge';
  import { accountLabel, repoLabel } from './lib/format';
  import {
    historyRuns,
    repositoryActivity,
    visibleRuns,
    type ActivityFilter,
  } from './lib/model';
  import { Panel } from './lib/panel.svelte';
  import { pinRequest } from './lib/pins';
  import type { Pin, Snapshot, Workflow } from './lib/types';
  import { Updater } from './lib/updater.svelte';

  const appVersion = appPackage.version;
  const panel = new Panel({ bridge, native, observe: observeSnapshots });
  const updater = new Updater(native);
  const snapshot = $derived(panel.snapshot);
  const demo = $derived(panel.demo);
  const accountId = $derived(panel.accountId);
  const repos = $derived(panel.repos);

  type ModalKind = 'settings' | 'dispatch' | 'connect';
  let modal = $state<ModalKind | null>(null);
  /** Element that opened the first of possibly chained dialogs. */
  let opener: HTMLElement | null = null;
  let settingsTab = $state<SettingsTab>('accounts');
  /** Login of a just-connected account whose repositories come next. */
  let settingsConnected = $state('');
  let dispatchSeed = $state.raw<DispatchSeed>({});
  let demoAccountConnected = $state(false);
  let tab = $state<ViewTab>('repositories');
  let query = $state('');
  let filter = $state<ActivityFilter>('all');
  let expanded = $state<number | null>(null);
  let searchField = $state<ReturnType<typeof SearchField>>();
  let toolbar = $state<ReturnType<typeof Toolbar>>();

  const needle = $derived(query.trim().toLowerCase());
  const matches = (text: string) =>
    !needle || text.toLowerCase().includes(needle);
  const repoName = (id: string) => repoLabel(snapshot, id);
  const accountName = (id: string) => accountLabel(snapshot, id, native);
  const repoAccountName = (id: string) =>
    accountName(
      snapshot?.repos.find((repo) => repo.id === id)?.accountId ?? '',
    );
  const matchedWorkflows = (id: string) =>
    snapshot?.workflows.filter(
      (workflow) =>
        workflow.repoId === id && matches(`${workflow.name} ${repoName(id)}`),
    ) ?? [];
  const clearQuery = () => (query = '');
  const warn = (value: string) => panel.showNotice(value, 'warning');

  const view = $derived(panel.viewSnapshot);
  const runs = $derived(
    view ? historyRuns(view, accountId, query, filter) : [],
  );
  const activeRuns = $derived(
    view ? visibleRuns(view, accountId, '', 'active').length : 0,
  );
  const failedRuns = $derived(
    view ? visibleRuns(view, accountId, '', 'failed').length : 0,
  );
  const pins = $derived(
    snapshot?.pins.filter(
      (pin) =>
        repos.some((repo) => repo.id === pin.repoId) &&
        matches(`${pin.label} ${repoName(pin.repoId)}`),
    ) ?? [],
  );
  const launchRepos = $derived(
    repos.filter((repo) => matchedWorkflows(repo.id).length > 0),
  );

  onMount(() => {
    const stop = panel.load(() => {
      if (native) void updater.check(true);
    });
    const updateTimer = native
      ? setInterval(() => void updater.check(true), 6 * 60 * 60 * 1000)
      : undefined;
    return () => {
      clearInterval(updateTimer);
      stop();
    };
  });

  function changeAccount(value: string) {
    panel.changeAccount(value);
    query = '';
    expanded = null;
    if (modal === 'dispatch') closeModal();
  }
  function connectedNative(value: Snapshot) {
    panel.viewEpoch.invalidate();
    panel.accept(value);
    // An explicit connection selects that entry; the service lists it last.
    const account = value.accounts.at(-1);
    changeAccount(account?.id ?? '');
    // A new account starts without selected repositories: that is the next step.
    if (account && !panel.repos.length)
      openSettings('repositories', account.login);
    else openSettings();
    void updater.check(true);
  }
  function connectedDemo(method: 'browser' | 'token') {
    demoAccountConnected = true;
    closeModal();
    panel.showNotice(
      method === 'token'
        ? 'Demo-Token geprüft und verworfen · demo-dev ist nur simuliert verbunden.'
        : 'Demo-Anmeldung bestätigt · demo-dev ist nur simuliert verbunden.',
    );
    void tick().then(() => toolbar?.focusPicker());
  }

  /** Dialogs own only their form state; running operations outlive them. */
  function closeModal() {
    modal = null;
  }
  /** Opens or replaces the dialog; a replacement keeps the first opener. */
  function showModal(kind: ModalKind) {
    if (!modal)
      opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    modal = kind;
  }
  function openSettings(initial: SettingsTab = 'accounts', connected = '') {
    settingsTab = initial;
    settingsConnected = connected;
    showModal('settings');
  }
  /** Empty-state actions open the missing step: connect, account or repositories. */
  function openNextStep() {
    if (native && !snapshot?.accounts.length) showModal('connect');
    else openSettings(panel.needsAccount ? 'accounts' : 'repositories');
  }
  function openDispatch(
    pin?: Pin,
    workflow?: Workflow,
    favoriteIntent = false,
  ) {
    dispatchSeed = { pin, workflow, favoriteIntent };
    showModal('dispatch');
  }
  /** Shows an accepted start in the full activity list. */
  function showRun(id: number | null) {
    closeModal();
    if (panel.notice?.runId) panel.notice = null;
    tab = 'activity';
    filter = 'all';
    query = '';
    expanded = id;
  }
  function launchPin(pin: Pin) {
    if (pin.quickStart)
      void panel.starts.dispatch(pinRequest(pin), { label: pin.label });
    else openDispatch(pin);
  }
  async function toggleFavorite(workflow: Workflow) {
    if ((await panel.toggleFavorite(workflow)) === 'incomplete')
      openDispatch(undefined, workflow, true);
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (
      event.key === '/' &&
      !modal &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLSelectElement)
    ) {
      event.preventDefault();
      searchField?.focus();
    }
  }}
/>

<main class="desktop" inert={modal !== null}>
  <div class="desktop-caption" aria-hidden="true">
    <span class="caption-dot"></span> YOUR REPOS. WITHIN REACH.
  </div>
  <section class="tray" aria-label="RepoTray">
    <AppHeader
      {native}
      {demo}
      connectivity={snapshot?.connectivity}
      accountCount={snapshot?.accounts.length ?? 0}
      {demoAccountConnected}
    />

    <Toolbar
      bind:this={toolbar}
      {native}
      {demo}
      accounts={snapshot?.accounts ?? []}
      {accountId}
      accountLabel={accountName(accountId)}
      repoCount={repos.length}
      refreshing={panel.refreshing}
      ready={!!snapshot}
      onAccountChange={changeAccount}
      onRefresh={() => void panel.refresh()}
      onSettings={() => openSettings()}
    />

    <ViewTabs
      {tab}
      {activeRuns}
      onSelect={(next) => {
        tab = next;
        query = '';
      }}
    />

    <div class="content">
      <SearchField bind:this={searchField} {tab} bind:query />

      <StatusBanners
        update={updater.info}
        {demo}
        {snapshot}
        error={panel.error}
        notice={panel.notice?.runId ? '' : (panel.notice?.text ?? '')}
        noticeTone={panel.notice?.tone ?? 'subtle'}
        onShowUpdate={() => openSettings('updates')}
        onDismissNotice={() => (panel.notice = null)}
      />
      {#if panel.notice?.runId}
        <NoticeBanner
          text={panel.notice.text}
          tone={panel.notice.tone}
          actionLabel="In Aktivität anzeigen"
          onAction={() => showRun(panel.notice?.runId ?? null)}
          onDismiss={() => (panel.notice = null)}
        />
      {/if}

      {#if !snapshot}
        <EmptyState
          icon="tray"
          iconSize={26}
          title={!panel.error
            ? 'Workflows werden geladen …'
            : demo
              ? 'Demo nicht geladen'
              : 'Daten konnten nicht geladen werden'}
          text={!panel.error
            ? 'Dein Überblick ist gleich bereit.'
            : demo
              ? 'Starte die Anwendung neu, um den lokalen Demo-Stand zu laden.'
              : 'Prüfe deine Verbindung und klicke auf Aktualisieren.'}
        />
      {:else if tab === 'repositories'}
        <RepositoriesView
          {pins}
          groups={view ? repositoryActivity(view, accountId, query) : []}
          isUncertain={panel.starts.isQuarantined}
          favorite={panel.favoritePin}
          {repoName}
          {accountName}
          dispatching={panel.starts.any}
          busy={panel.pinsBusy}
          blocked={panel.blocked}
          needsAccount={panel.needsAccount}
          hasAccounts={!!snapshot.accounts.length}
          accountNotice={panel.accountNotice}
          searching={!!query}
          onConfigure={(pin) => openDispatch(pin)}
          onRemove={panel.deletePin}
          onLaunch={launchPin}
          onOpenWorkflow={(workflow) => openDispatch(undefined, workflow)}
          onFavorite={(workflow) => void toggleFavorite(workflow)}
          onClearQuery={clearQuery}
          onOpenSettings={openNextStep}
        />
      {:else if tab === 'activity'}
        <ActivityView
          {runs}
          {filter}
          {expanded}
          {activeRuns}
          {failedRuns}
          {demo}
          {native}
          needsAccount={panel.needsAccount}
          hasAccounts={!!snapshot.accounts.length}
          hasRepos={repos.length > 0}
          searching={!!query}
          accountNotice={panel.accountNotice}
          {repoName}
          {repoAccountName}
          onFilter={(next) => (filter = next)}
          onToggle={(id) => (expanded = expanded === id ? null : id)}
          onOpenSettings={openNextStep}
          onClearQuery={clearQuery}
          onNotice={(text, tone) => panel.showNotice(text, tone)}
        />
      {:else}
        <LaunchView
          {pins}
          {launchRepos}
          workflowsFor={matchedWorkflows}
          isUncertain={panel.starts.isQuarantined}
          {repoName}
          {accountName}
          {demo}
          dispatching={panel.starts.any}
          busy={panel.pinsBusy}
          blocked={panel.blocked}
          searching={!!query.trim()}
          hasRepos={repos.length > 0}
          needsAccount={panel.needsAccount}
          onLaunch={launchPin}
          onConfigure={(pin) => openDispatch(pin)}
          onRemove={panel.deletePin}
          onOpenWorkflow={(workflow) => openDispatch(undefined, workflow)}
          onNew={() => openDispatch()}
          onClearQuery={clearQuery}
          onOpenSettings={() =>
            openSettings(panel.needsAccount ? 'accounts' : 'repositories')}
        />
      {/if}
    </div>

    <AppFooter
      stale={!!snapshot?.stale}
      {demo}
      updatedAt={snapshot?.updatedAt}
      refreshing={panel.refreshing}
      onRefresh={() => void panel.refresh()}
    />
  </section>
  <div class="desktop-footnote" aria-hidden="true">
    <span class="tiny-line"></span> MADE FOR YOUR FLOW
    <span class="tiny-line"></span>
  </div>
</main>

{#if modal === 'settings'}
  <SettingsDialog
    {snapshot}
    {native}
    {demo}
    {accountId}
    accountNotice={panel.accountNotice}
    scenario={panel.scenario}
    {updater}
    {appVersion}
    initialTab={settingsTab}
    connected={settingsConnected}
    busy={panel.settingsBusy}
    saving={panel.selectionBusy}
    returnFocus={() => opener}
    onClose={closeModal}
    onConnect={() => showModal('connect')}
    onChangeAccount={changeAccount}
    onScenario={panel.changeScenario}
    onReset={panel.resetDemo}
    onDisconnect={panel.disconnectAccount}
    onSaveSelection={panel.saveSelection}
    onRefreshAccess={panel.refreshAccess}
    onManageInstallation={panel.manageInstallation}
  />
{:else if modal === 'connect'}
  <Modal
    title="GitHub verbinden"
    eyebrow={`REPOTRAY · ${demo ? 'DEMO' : 'GITHUB'}`}
    returnFocus={() => opener}
    onClose={closeModal}
  >
    {#if native}<NativeConnect
        accounts={snapshot?.accounts ?? []}
        activeAccountId={accountId}
        onSelectAccount={changeAccount}
        onConnected={connectedNative}
        onClose={closeModal}
      />{:else}<ConnectPanel
        onConnected={connectedDemo}
        onClose={closeModal}
        onSettings={() => openSettings()}
      />{/if}
  </Modal>
{:else if modal === 'dispatch'}
  <DispatchDialog
    {panel}
    seed={dispatchSeed}
    returnFocus={() => opener}
    onClose={closeModal}
    onShowRun={showRun}
    onLinkError={warn}
  />
{/if}
