<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ActivityView from './lib/ActivityView.svelte';
  import AppFooter from './lib/AppFooter.svelte';
  import AppHeader from './lib/AppHeader.svelte';
  import EmptyState from './lib/EmptyState.svelte';
  import LaunchView from './lib/LaunchView.svelte';
  import Icon from './lib/Icon.svelte';
  import PinnedFavorites from './lib/PinnedFavorites.svelte';
  import RepositoryList from './lib/RepositoryList.svelte';
  import RunLink from './lib/RunLink.svelte';
  import SearchField from './lib/SearchField.svelte';
  import StatusBanners, { type NoticeTone } from './lib/StatusBanners.svelte';
  import Toolbar from './lib/Toolbar.svelte';
  import ViewTabs, { type ViewTab } from './lib/ViewTabs.svelte';
  import appPackage from '../package.json';
  const appVersion = appPackage.version;
  import { invoke } from '@tauri-apps/api/core';
  import { Updater } from './lib/updater.svelte';
  import NativeConnect from './lib/NativeConnect.svelte';
  import ConnectPanel from './lib/ConnectPanel.svelte';
  import SettingsDialog, {
    type SettingsTab,
  } from './lib/SettingsDialog.svelte';
  import {
    readActiveAccount,
    rememberActiveAccount,
    restoreActiveAccount,
  } from './lib/accountSelection';
  import { bridge, native, observeSnapshots } from './lib/bridge';
  import Modal from './lib/Modal.svelte';
  import { accountLabel, errorMessage, repoLabel } from './lib/format';
  import {
    defaultInputs,
    fullRepo,
    repositoryActivity,
    historyRuns,
    RequestEpoch,
    safeGitHubUrl,
    targetKey,
    validateDispatch,
    visibleRuns,
    type ActivityFilter,
  } from './lib/model';
  import type {
    DemoScenario,
    DispatchOutcome,
    DispatchRequest,
    DispatchTarget,
    InputValue,
    Pin,
    Snapshot,
    Workflow,
  } from './lib/types';

  // Snapshots are replaced wholesale, never mutated: no deep proxy needed.
  let snapshot = $state.raw<Snapshot | null>(null);
  const demo = $derived(snapshot?.mode !== 'live');
  const updater = new Updater(native);
  /** Tab the settings dialog opens on. */
  let settingsTab = $state<SettingsTab>('accounts');
  let demoAccountConnected = $state(false);
  let tab = $state<ViewTab>('repositories');
  let accountId = $state('');
  let accountSelectionNotice = $state('');
  let accountSelectionReady = false;
  let query = $state('');
  let filter = $state<ActivityFilter>('all');
  let favoriteIntent = $state(false);
  let expanded = $state<number | null>(null);
  type ModalKind = 'settings' | 'dispatch' | 'connect';
  let modal = $state<ModalKind | null>(null);
  /** Element that opened the first of possibly chained dialogs. */
  let opener: HTMLElement | null = null;
  let scenario = $state<DemoScenario>('normal');
  let refreshing = $state(false);
  let saving = $state(false);
  let dispatching = $state(false);
  let error = $state('');
  let notice = $state('');
  let noticeTone = $state<NoticeTone>('subtle');
  let dialogError = $state('');
  let dialogNotice = $state('');
  let dialogNoticeTone = $state<'subtle' | 'warning'>('subtle');
  let outcome = $state<DispatchOutcome | null>(null);
  let quarantinedTargets = $state<Set<string>>(new Set());
  let repoId = $state('');
  let workflowId = $state<number>(0);
  let ref = $state('main');
  let inputs = $state<Record<string, InputValue>>({});
  let pinLabel = $state('');
  let pinQuickStart = $state(false);
  let editingPinId = $state<string | null>(null);
  let mutationBusy = $state(false);
  let searchField = $state<ReturnType<typeof SearchField>>();
  let toolbar = $state<ReturnType<typeof Toolbar>>();
  const viewEpoch = new RequestEpoch();
  const dialogEpoch = new RequestEpoch();

  /** Native mode without a deliberately chosen account shows no repository data. */
  const needsAccount = $derived(native && !accountId);
  const repos = $derived(
    snapshot?.repos.filter(
      (repo) =>
        repo.selected &&
        (native
          ? repo.accountId === accountId
          : !accountId || repo.accountId === accountId),
    ) ?? [],
  );
  /** Native views stay empty until an account is chosen deliberately. */
  const viewSnapshot = $derived(
    snapshot && (!native || accountId) ? snapshot : null,
  );
  const runs = $derived(
    viewSnapshot ? historyRuns(viewSnapshot, accountId, query, filter) : [],
  );
  const repoGroups = $derived(
    viewSnapshot ? repositoryActivity(viewSnapshot, accountId, query) : [],
  );
  const activeRuns = $derived(
    viewSnapshot
      ? visibleRuns(viewSnapshot, accountId, '', 'active').length
      : 0,
  );
  const failedRuns = $derived(
    viewSnapshot
      ? visibleRuns(viewSnapshot, accountId, '', 'failed').length
      : 0,
  );
  const pins = $derived(
    snapshot?.pins.filter(
      (pin) =>
        repos.some((repo) => repo.id === pin.repoId) &&
        (!query.trim() ||
          `${pin.label} ${repoName(pin.repoId)}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())),
    ) ?? [],
  );
  const launchRepos = $derived(
    repos.filter((repo) => matchedWorkflows(repo.id).length > 0),
  );
  const chosenRepo = $derived(
    snapshot?.repos.find((repo) => repo.id === repoId),
  );
  const workflows = $derived(
    snapshot?.workflows.filter((workflow) => workflow.repoId === repoId) ?? [],
  );
  const chosenWorkflow = $derived(
    workflows.find((workflow) => workflow.id === workflowId),
  );
  const validation = $derived(
    snapshot && chosenRepo && chosenWorkflow
      ? validateDispatch(snapshot, request('validation'))
      : 'Wähle Repository und Workflow.',
  );
  const blocked = $derived(snapshot?.connectivity !== 'online');
  const targetUncertain = $derived(isQuarantined(request('context')));

  function isQuarantined(target: DispatchTarget) {
    return quarantinedTargets.has(targetKey(target));
  }
  function matchedWorkflows(id: string) {
    return (
      snapshot?.workflows.filter(
        (workflow) =>
          workflow.repoId === id &&
          (!query.trim() ||
            `${workflow.name} ${repoName(id)}`
              .toLowerCase()
              .includes(query.trim().toLowerCase())),
      ) ?? []
    );
  }
  async function checkStartStatus() {
    const target = targetKey(request('status'));
    const latest = await refresh();
    if (modal === 'dispatch' && targetKey(request('status')) === target) {
      if (!latest || latest.stale || latest.connectivity !== 'online') {
        dialogNotice = '';
        dialogError =
          'Status konnte nicht geprüft werden. Starts bleiben gesperrt.';
      } else {
        dialogError = '';
        dialogNoticeTone = 'warning';
        dialogNotice =
          'Status geprüft. Die Startannahme bleibt ungeklärt; ein erneuter Start ist weiterhin gesperrt.';
      }
    }
  }

  function connectedNative(value: Snapshot) {
    viewEpoch.invalidate();
    acceptSnapshot(value);
    changeAccount(value.accounts.at(-1)?.id ?? '');
    openSettings();
    void updater.check(true);
  }
  async function disconnectAccount(id: string) {
    if (mutationBusy) return;
    mutationBusy = true;
    try {
      const value = await invoke<Snapshot>('disconnect_account', {
        accountId: id,
      });
      acceptSnapshot(value);
    } finally {
      mutationBusy = false;
    }
  }
  function connectedDemo(method: 'browser' | 'token') {
    demoAccountConnected = true;
    closeModal();
    showNotice(
      method === 'token'
        ? 'Demo-Token geprüft und verworfen · demo-dev ist nur simuliert verbunden.'
        : 'Demo-Anmeldung bestätigt · demo-dev ist nur simuliert verbunden.',
    );
    void tick().then(() => toolbar?.focusPicker());
  }
  function repoName(id: string) {
    return repoLabel(snapshot, id);
  }
  function accountName(id: string) {
    return accountLabel(snapshot, id, native);
  }
  function repoAccountName(repoId: string) {
    return accountName(
      snapshot?.repos.find((repo) => repo.id === repoId)?.accountId ?? '',
    );
  }
  function showNotice(value: string, tone: NoticeTone = 'subtle') {
    notice = value;
    noticeTone = tone;
  }
  function clearQuery() {
    query = '';
  }
  function warn(value: string) {
    showNotice(value, 'warning');
  }
  function request(id: string): DispatchRequest {
    return {
      accountId: chosenRepo?.accountId ?? '',
      repoId,
      workflowId,
      ref,
      inputs: { ...inputs },
      requestId: id,
    };
  }

  function acceptSnapshot(value: Snapshot) {
    snapshot = value;
    if (!native) return;
    if (!accountSelectionReady) {
      const restored = restoreActiveAccount(
        value.accounts,
        readActiveAccount(),
      );
      accountId = restored.id;
      accountSelectionNotice = restored.missing
        ? 'Das gespeicherte Konto ist nicht mehr verbunden. Wähle ein aktives Konto neu aus.'
        : '';
      if (restored.missing) rememberActiveAccount('');
      accountSelectionReady = true;
    } else if (
      accountId &&
      !value.accounts.some((account) => account.id === accountId)
    ) {
      changeAccount('');
      accountSelectionNotice =
        'Das aktive Konto wurde entfernt. Wähle ein anderes Konto bewusst aus.';
    }
  }

  onMount(() => {
    const ticket = viewEpoch.next();
    bridge
      .snapshot()
      .then((value) => {
        if (viewEpoch.current(ticket)) {
          acceptSnapshot(value);
          if (native) void updater.check(true);
        }
      })
      .catch((cause) => {
        if (viewEpoch.current(ticket)) error = errorMessage(cause);
      });
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void observeSnapshots((value) => {
      if (!disposed && !saving && !mutationBusy && !dispatching)
        acceptSnapshot(value);
    }).then((stop) => {
      if (disposed) stop();
      else unsubscribe = stop;
    });
    const updateTimer = native
      ? setInterval(() => void updater.check(true), 6 * 60 * 60 * 1000)
      : undefined;
    return () => {
      clearInterval(updateTimer);
      disposed = true;
      unsubscribe?.();
      viewEpoch.invalidate();
      refreshing = false;
      dialogEpoch.invalidate();
    };
  });

  function changeAccount(value: string) {
    viewEpoch.invalidate();
    refreshing = false;
    dialogEpoch.invalidate();
    accountId =
      native &&
      value &&
      !snapshot?.accounts.some((account) => account.id === value)
        ? ''
        : value;
    accountSelectionNotice = '';
    if (native && !rememberActiveAccount(accountId))
      accountSelectionNotice =
        'Die Kontoauswahl gilt für diese Sitzung; sie konnte nicht gespeichert werden.';
    query = '';
    expanded = null;
    error = '';
    notice = '';
    refreshing = false;
    if (modal === 'dispatch') closeModal();
  }
  async function refresh() {
    if (refreshing) return;
    const ticket = viewEpoch.next();
    refreshing = true;
    error = '';
    notice = '';
    try {
      const value = await bridge.refreshSnapshot();
      if (viewEpoch.current(ticket)) {
        acceptSnapshot(value);
        if (!value.stale)
          showNotice(
            demo ? 'Demo-Status aktualisiert.' : 'GitHub-Status aktualisiert.',
          );
      }
      return value;
    } catch (cause) {
      if (viewEpoch.current(ticket)) error = errorMessage(cause);
      return null;
    } finally {
      if (viewEpoch.current(ticket)) refreshing = false;
    }
  }
  async function manageBrowserRepositories() {
    await invoke('open_browser_installation');
  }
  async function refreshRepositoryAccess() {
    if (mutationBusy) return null;
    const ticket = viewEpoch.next();
    mutationBusy = true;
    try {
      const value = await invoke<Snapshot>('refresh_repositories');
      if (!viewEpoch.current(ticket)) return null;
      acceptSnapshot(value);
      return value;
    } catch (cause) {
      if (!viewEpoch.current(ticket)) return null;
      throw cause;
    } finally {
      if (viewEpoch.current(ticket)) mutationBusy = false;
    }
  }
  function resetDialog() {
    dialogEpoch.invalidate();
    dialogError = '';
    dialogNotice = '';
    outcome = null;
    dispatching = false;
    saving = false;
    mutationBusy = false;
  }
  function closeModal() {
    resetDialog();
    modal = null;
  }
  /** Opens or replaces the dialog; a replacement keeps the first opener. */
  function showModal(kind: ModalKind) {
    if (!modal)
      opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    resetDialog();
    modal = kind;
  }
  function openSettings(initial: SettingsTab = 'accounts') {
    settingsTab = initial;
    showModal('settings');
  }
  function selectWorkflow(value: number) {
    dialogEpoch.invalidate();
    workflowId = value;
    outcome = null;
    dialogError = '';
    dialogNotice = '';
    editingPinId = null;
    const workflow = snapshot?.workflows.find(
      (item) => item.id === value && item.repoId === repoId,
    );
    inputs = workflow ? defaultInputs(workflow) : {};
    ref = chosenRepo?.defaultBranch ?? 'main';
    if (workflow && !workflow.refs.includes(ref)) ref = workflow.refs[0] ?? '';
    pinLabel = workflow?.name ?? '';
    pinQuickStart = false;
    dispatching = false;
    saving = false;
  }
  function selectRepo(value: string) {
    repoId = value;
    const candidates =
      snapshot?.workflows.filter((workflow) => workflow.repoId === value) ?? [];
    selectWorkflow(
      (candidates.find((workflow) => workflow.dispatch) ?? candidates[0])?.id ??
        0,
    );
  }
  function openDispatch(pin?: Pin, workflow?: Workflow) {
    showModal('dispatch');
    favoriteIntent = false;
    selectRepo(
      pin?.repoId ??
        workflow?.repoId ??
        repos.find((repo) => repo.permission === 'write')?.id ??
        repos[0]?.id ??
        '',
    );
    if (workflow) selectWorkflow(workflow.id);
    if (pin) {
      selectWorkflow(pin.workflowId);
      ref = pin.ref;
      inputs = { ...pin.inputs };
      pinLabel = pin.label;
      pinQuickStart = pin.quickStart;
      editingPinId = pin.id;
    }
  }
  function changeRef(value: string) {
    dialogEpoch.invalidate();
    ref = value;
    outcome = null;
    dialogError = '';
    dialogNotice = '';
    dispatching = false;
  }
  function setInput(name: string, value: InputValue) {
    inputs = { ...inputs, [name]: value };
    dialogError = '';
  }

  async function dispatch(pin?: Pin) {
    if (dispatching || saving) return;
    const payload = pin
      ? {
          accountId: pin.accountId,
          repoId: pin.repoId,
          workflowId: pin.workflowId,
          ref: pin.ref,
          inputs: { ...pin.inputs },
          requestId: crypto.randomUUID(),
        }
      : request(crypto.randomUUID());
    if (!snapshot) return;
    const invalid = validateDispatch(snapshot, payload);
    if (invalid) {
      if (modal === 'dispatch') dialogError = invalid;
      else error = invalid;
      return;
    }
    const ticket = dialogEpoch.next();
    const viewTicket = viewEpoch.next();
    refreshing = false;
    dispatching = true;
    dialogError = '';
    dialogNotice = '';
    error = '';
    notice = '';
    outcome = null;
    try {
      const result = await bridge.dispatchWorkflow(payload);
      if (result.state === 'uncertain')
        quarantinedTargets = new Set([
          ...quarantinedTargets,
          targetKey(payload),
        ]);
      if (!dialogEpoch.current(ticket)) return;
      outcome = result;
      if (modal !== 'dispatch')
        showNotice(
          result.message,
          result.state === 'accepted'
            ? 'subtle'
            : result.state === 'uncertain'
              ? 'warning'
              : 'danger',
        );
      if (result.state === 'accepted') {
        const value = await bridge.snapshot();
        if (dialogEpoch.current(ticket) && viewEpoch.current(viewTicket))
          acceptSnapshot(value);
      }
    } catch (cause) {
      if (dialogEpoch.current(ticket)) {
        if (modal === 'dispatch') dialogError = errorMessage(cause);
        else error = errorMessage(cause);
      }
    } finally {
      if (dialogEpoch.current(ticket)) dispatching = false;
    }
  }
  function launchPin(pin: Pin) {
    if (pin.quickStart) {
      closeModal();
      void dispatch(pin);
    } else openDispatch(pin);
  }

  function favoritePin(workflow: Workflow) {
    const repo = snapshot?.repos.find((repo) => repo.id === workflow.repoId);
    const defaults = defaultInputs(workflow);
    return snapshot?.pins.find(
      (pin) =>
        pin.accountId === repo?.accountId &&
        pin.repoId === workflow.repoId &&
        pin.workflowId === workflow.id &&
        pin.ref === repo?.defaultBranch &&
        Object.keys(pin.inputs).length === Object.keys(defaults).length &&
        Object.entries(defaults).every(
          ([key, value]) => pin.inputs[key] === value,
        ),
    );
  }
  async function toggleFavorite(workflow: Workflow) {
    if (!snapshot || mutationBusy || dispatching) return;
    const existing = favoritePin(workflow);
    if (existing) {
      await deletePin(existing.id);
      return;
    }
    const repo = snapshot.repos.find((repo) => repo.id === workflow.repoId);
    if (!repo) return;
    const pin: Pin = {
      id: crypto.randomUUID(),
      label: workflow.name,
      accountId: repo.accountId,
      repoId: repo.id,
      workflowId: workflow.id,
      ref: repo.defaultBranch,
      inputs: defaultInputs(workflow),
      quickStart: false,
    };
    const invalid = validateDispatch(snapshot, {
      ...pin,
      requestId: 'favorite',
    });
    if (invalid) {
      openDispatch(undefined, workflow);
      favoriteIntent = true;
      dialogNotice =
        'Ergänze die benötigten Angaben und speichere die Action als Vorlage.';
      return;
    }
    mutationBusy = true;
    const ticket = viewEpoch.next();
    refreshing = false;
    try {
      const value = await bridge.savePin(pin);
      if (viewEpoch.current(ticket)) {
        acceptSnapshot(value);
        showNotice('Action als Favorit gespeichert.');
      }
    } catch (cause) {
      if (viewEpoch.current(ticket)) error = errorMessage(cause);
    } finally {
      mutationBusy = false;
    }
  }

  async function savePin(asNew = false) {
    if (!snapshot || !chosenRepo || saving || dispatching) return;
    const pin: Pin = {
      id: !asNew && editingPinId ? editingPinId : crypto.randomUUID(),
      label: pinLabel,
      accountId: chosenRepo.accountId,
      repoId,
      workflowId,
      ref,
      inputs: { ...inputs },
      quickStart: pinQuickStart,
    };
    const ticket = dialogEpoch.next();
    saving = true;
    dialogError = '';
    dialogNotice = '';
    try {
      const value = await bridge.savePin(pin);
      if (dialogEpoch.current(ticket)) {
        acceptSnapshot(value);
        editingPinId = pin.id;
        dialogNoticeTone = 'subtle';
        dialogNotice = 'Vorlage lokal gespeichert.';
      }
    } catch (cause) {
      if (dialogEpoch.current(ticket)) dialogError = errorMessage(cause);
    } finally {
      if (dialogEpoch.current(ticket)) saving = false;
    }
  }
  async function deletePin(pinId: string) {
    if (mutationBusy) return;
    mutationBusy = true;
    const ticket = viewEpoch.next();
    refreshing = false;
    try {
      const value = await bridge.deletePin(pinId);
      if (viewEpoch.current(ticket)) {
        acceptSnapshot(value);
        showNotice('Vorlage entfernt.');
      }
    } catch (cause) {
      if (viewEpoch.current(ticket)) error = errorMessage(cause);
    } finally {
      mutationBusy = false;
    }
  }
  async function saveSettings(repoIds: string[]) {
    if (mutationBusy) return;
    mutationBusy = true;
    const ticket = viewEpoch.next();
    refreshing = false;
    try {
      const value = await bridge.selectRepos(repoIds);
      if (viewEpoch.current(ticket)) acceptSnapshot(value);
      showNotice('Repository-Auswahl gespeichert.');
    } finally {
      mutationBusy = false;
    }
  }
  async function changeScenario(value: DemoScenario) {
    const ticket = viewEpoch.next();
    refreshing = false;
    scenario = value;
    const data = await bridge.setDemoScenario(value);
    if (viewEpoch.current(ticket)) snapshot = data;
  }
  async function resetDemo() {
    const ticket = viewEpoch.next();
    refreshing = false;
    mutationBusy = true;
    try {
      const value = await bridge.resetDemo();
      if (viewEpoch.current(ticket)) acceptSnapshot(value);
      accountId = '';
      scenario = 'normal';
      quarantinedTargets = new Set();
      showNotice(
        'Demo zurückgesetzt. Lokale Vorlagen und Auswahl wurden zurückgesetzt.',
      );
    } finally {
      mutationBusy = false;
    }
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
      {refreshing}
      ready={!!snapshot}
      onAccountChange={changeAccount}
      onRefresh={refresh}
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
        {error}
        {notice}
        {noticeTone}
        onShowUpdate={() => openSettings('updates')}
        onDismissNotice={() => (notice = '')}
      />

      {#if !snapshot}
        <EmptyState
          icon="tray"
          iconSize={26}
          title={error ? 'Demo nicht geladen' : 'Workflows werden sortiert …'}
          text={error
            ? 'Starte die Anwendung neu, um den lokalen Demo-Stand zu laden.'
            : 'Dein Überblick ist gleich bereit.'}
        />
      {:else if tab === 'repositories'}
        <PinnedFavorites
          {pins}
          isUncertain={isQuarantined}
          {repoName}
          {accountName}
          {dispatching}
          busy={mutationBusy}
          {blocked}
          onConfigure={(pin) => openDispatch(pin)}
          onRemove={deletePin}
          onLaunch={launchPin}
        />
        <div class="section-heading repository-heading">
          <h2>Deine Repositories</h2>
          <span>Zuletzt aktiv zuerst</span>
        </div>
        <RepositoryList
          groups={repoGroups}
          onopen={(workflow) => openDispatch(undefined, workflow)}
          onfavorite={(workflow) => void toggleFavorite(workflow)}
          favorite={favoritePin}
          busy={mutationBusy}
          {dispatching}
          {blocked}
        />
        {#if !repoGroups.length}<EmptyState
            icon="repo"
            iconSize={25}
            title={needsAccount
              ? snapshot.accounts.length
                ? 'Wähle ein aktives Konto'
                : 'Verbinde dein GitHub-Konto'
              : query
                ? 'Keine passenden Repositories'
                : 'Noch keine Repositories ausgewählt'}
            text={needsAccount
              ? accountSelectionNotice ||
                'Wähle Konto und Repositories in den Einstellungen.'
              : query
                ? 'Suche nach einem Repository oder einer Action.'
                : 'Wähle Repositories in den Einstellungen aus.'}
            action={query
              ? { label: 'Suche leeren', icon: 'close', run: clearQuery }
              : {
                  label: needsAccount
                    ? 'Konto in Einstellungen wählen'
                    : 'Repositories auswählen',
                  icon: 'arrow',
                  run: () => openSettings(),
                }}
          />{/if}
      {:else if tab === 'activity'}
        <ActivityView
          {runs}
          {filter}
          {expanded}
          {activeRuns}
          {failedRuns}
          {demo}
          {native}
          {needsAccount}
          hasAccounts={!!snapshot.accounts.length}
          hasRepos={repos.length > 0}
          searching={!!query}
          accountNotice={accountSelectionNotice}
          {repoName}
          {repoAccountName}
          onFilter={(next) => (filter = next)}
          onToggle={(id) => (expanded = expanded === id ? null : id)}
          onOpenSettings={() => openSettings()}
          onLinkError={warn}
        />
      {:else}
        <LaunchView
          {pins}
          {launchRepos}
          workflowsFor={matchedWorkflows}
          isUncertain={isQuarantined}
          {repoName}
          {accountName}
          {demo}
          {dispatching}
          busy={mutationBusy}
          {blocked}
          searching={!!query.trim()}
          hasRepos={repos.length > 0}
          {needsAccount}
          onLaunch={launchPin}
          onConfigure={(pin) => openDispatch(pin)}
          onRemove={deletePin}
          onOpenWorkflow={(workflow) => openDispatch(undefined, workflow)}
          onNew={() => openDispatch()}
          onClearQuery={clearQuery}
          onOpenSettings={() => openSettings()}
        />
      {/if}
    </div>

    <AppFooter
      stale={!!snapshot?.stale}
      {demo}
      updatedAt={snapshot?.updatedAt}
      {refreshing}
      onRefresh={refresh}
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
    accountNotice={accountSelectionNotice}
    {scenario}
    {updater}
    {appVersion}
    initialTab={settingsTab}
    busy={mutationBusy}
    returnFocus={() => opener}
    onClose={closeModal}
    onConnect={() => showModal('connect')}
    onChangeAccount={changeAccount}
    onScenario={changeScenario}
    onReset={resetDemo}
    onDisconnect={disconnectAccount}
    onSaveSelection={saveSettings}
    onRefreshAccess={refreshRepositoryAccess}
    onManageInstallation={manageBrowserRepositories}
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
  <Modal
    title="Workflow starten"
    eyebrow={`REPOTRAY · ${demo ? 'DEMO' : 'GITHUB'}`}
    returnFocus={() => opener}
    onClose={closeModal}
  >
    <form
      onsubmit={(event) => {
        event.preventDefault();
        // Starts require an explicit activation of the start button.
      }}
    >
      <div class="modal-body dispatch-body">
        <div class="simulation-note">
          <Icon name="shield" size={15} /><span
            >{demo
              ? 'Lokale Simulation · kein echter Workflow-Start'
              : 'Echter GitHub-Workflow-Start · Konto und Ziel prüfen'}</span
          >
        </div>
        <label class="field"
          ><span>Repository</span><select
            aria-label="Repository"
            value={repoId}
            onchange={(event) => selectRepo(event.currentTarget.value)}
            disabled={dispatching}
            >{#if !repos.length}<option value=""
                >Keine Repositories ausgewählt</option
              >{/if}{#each repos as repo}<option value={repo.id}
                >{fullRepo(repo)} · {accountName(repo.accountId)}</option
              >{/each}</select
          ></label
        ><label class="field"
          ><span>Workflow</span><select
            aria-label="Workflow"
            value={workflowId}
            onchange={(event) =>
              selectWorkflow(Number(event.currentTarget.value))}
            disabled={dispatching}
            >{#if !workflows.length}<option value={0}
                >Kein Workflow verfügbar</option
              >{/if}{#each workflows as workflow}<option value={workflow.id}
                >{workflow.name}{!workflow.dispatch
                  ? ' · kein manueller Start'
                  : ''}</option
              >{/each}</select
          ></label
        >{#if chosenWorkflow}<div class="workflow-path">
            {chosenWorkflow.path}
          </div>{/if}<label class="field"
          ><span>Branch oder Tag<span class="required">*</span></span><select
            aria-label="Branch oder Tag"
            value={ref}
            onchange={(event) => changeRef(event.currentTarget.value)}
            disabled={dispatching}
            >{#each chosenWorkflow?.refs ?? [] as branch}<option value={branch}
                >{branch}{branch === chosenRepo?.defaultBranch
                  ? ' · Standardbranch'
                  : ''}</option
              >{/each}</select
          ></label
        >
        {#if chosenWorkflow?.inputs.length}<div class="input-heading">
            <span>EINGABEN</span><span
              >{chosenWorkflow.inputs.length} Parameter</span
            >
          </div>{/if}
        {#each chosenWorkflow?.inputs ?? [] as input}
          {#if input.type === 'boolean'}<label class="boolean-field"
              ><span
                ><strong>{input.label}</strong><small
                  >Workflow-Parameter · boolean</small
                ></span
              ><input
                type="checkbox"
                aria-label={input.label}
                checked={inputs[input.name] === true}
                onchange={(event) =>
                  setInput(input.name, event.currentTarget.checked)}
                disabled={dispatching}
              /><span class="switch" aria-hidden="true"></span></label
            >
          {:else}<label class="field"
              ><span
                >{input.label}{#if input.required}<span class="required">*</span
                  >{/if}<small>{input.type}</small></span
              >{#if input.type === 'choice' || input.type === 'environment'}<select
                  aria-label={input.label}
                  value={String(inputs[input.name] ?? '')}
                  onchange={(event) =>
                    setInput(input.name, event.currentTarget.value)}
                  disabled={dispatching}
                  >{#if !input.required}<option value="">Nicht gesetzt</option
                    >{/if}{#each input.options as option}<option value={option}
                      >{option}</option
                    >{/each}</select
                >{:else if input.type === 'number'}<input
                  type="number"
                  aria-label={input.label}
                  value={inputs[input.name] as number}
                  oninput={(event) =>
                    setInput(
                      input.name,
                      event.currentTarget.value === ''
                        ? ''
                        : Number(event.currentTarget.value),
                    )}
                  step="any"
                  disabled={dispatching}
                />{:else}<input
                  type="text"
                  aria-label={input.label}
                  value={String(inputs[input.name] ?? '')}
                  oninput={(event) =>
                    setInput(input.name, event.currentTarget.value)}
                  autocomplete="off"
                  disabled={dispatching}
                />{/if}</label
            >{/if}
        {/each}
        {#if validation}<div class="alert warning">
            <Icon name="shield" size={16} /><span>{validation}</span>
          </div>{/if}
        {#if blocked}<div class="alert warning">
            <Icon name="warning" size={16} /><span
              >{snapshot?.connectivity === 'offline'
                ? 'Offline. Starts sind deaktiviert; der letzte Stand bleibt sichtbar.'
                : 'Zugriff verweigert. Starts sind deaktiviert.'}</span
            >
          </div>{/if}
        <details class="save-pin" open={favoriteIntent}>
          <summary
            ><Icon name="pin" size={14} />Als Vorlage speichern<Icon
              name="down"
              size={13}
            /></summary
          >
          <div class="save-pin-body">
            <label class="field"
              ><span>Name der Vorlage</span><input
                aria-label="Name der Vorlage"
                bind:value={pinLabel}
                onkeydown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    if (
                      pinLabel.trim() &&
                      !validation &&
                      !dispatching &&
                      !saving
                    )
                      void savePin();
                  }
                }}
                disabled={dispatching || saving}
                maxlength="80"
                placeholder="z. B. Windows build"
              /></label
            ><label class="quick-opt-in"
              ><input
                type="checkbox"
                bind:checked={pinQuickStart}
                disabled={dispatching || saving}
              /><span
                >Schnellstart ausdrücklich aktivieren<small
                  >Startet diese Vorlage ohne erneute Bestätigung. Nur für diese
                  Auswahl.</small
                ></span
              ></label
            >
            <p class="field-help">
              Speichert Account, Repository, Workflow, Ref und nicht geheime
              Eingaben lokal.
            </p>
            <button
              type="button"
              class="secondary-button compact"
              onclick={() => void savePin()}
              disabled={saving ||
                dispatching ||
                !!validation ||
                !pinLabel.trim()}
              ><Icon name="pin" size={13} />{saving
                ? 'Speichert …'
                : editingPinId
                  ? 'Vorlage aktualisieren'
                  : 'Vorlage speichern'}</button
            >
            {#if editingPinId}<button
                type="button"
                class="text-button copy-template"
                onclick={() => void savePin(true)}
                disabled={saving ||
                  dispatching ||
                  !!validation ||
                  !pinLabel.trim()}
                >Als neue Vorlage speichern<Icon
                  name="plus"
                  size={13}
                /></button
              >{/if}
          </div>
        </details>
        {#if dialogError}<div class="alert danger" role="alert">
            <Icon name="warning" size={16} /><span>{dialogError}</span>
          </div>{/if}
        {#if dialogNotice}<div
            class={`alert ${dialogNoticeTone}`}
            role="status"
          >
            <Icon
              name={dialogNoticeTone === 'warning' ? 'warning' : 'check'}
              size={16}
            /><span>{dialogNotice}</span>
          </div>{/if}
        {#if targetUncertain && !outcome}<div
            class="outcome uncertain"
            role="status"
          >
            <Icon name="warning" size={18} />
            <div>
              <strong>Startstatus ungeklärt</strong>
              <p>
                Für dieses Ziel fehlt die Startbestätigung. Ein erneuter Start
                bleibt gesperrt. Prüfe zuerst den Status.
              </p>
              <button
                type="button"
                class="text-button"
                onclick={checkStartStatus}
                disabled={refreshing}
                >Status prüfen<Icon name="refresh" size={12} /></button
              >
            </div>
          </div>{/if}
        {#if outcome}<div
            class="outcome"
            class:accepted={outcome.state === 'accepted'}
            class:uncertain={outcome.state === 'uncertain'}
            class:rejected={outcome.state === 'rejected'}
            role="status"
          >
            <Icon
              name={outcome.state === 'accepted' ? 'check' : 'warning'}
              size={18}
            />
            <div>
              <strong
                >{outcome.state === 'accepted'
                  ? demo
                    ? 'Simulierter Start angenommen'
                    : 'GitHub hat den Start angenommen'
                  : outcome.state === 'uncertain'
                    ? 'Startstatus ungeklärt'
                    : 'Start abgelehnt'}</strong
              >
              <p>{outcome.message}</p>
              {#if outcome.state === 'accepted' && outcome.runId}
                {@const runUrl = safeGitHubUrl(outcome.htmlUrl ?? '')}
                {#if runUrl}<RunLink
                    url={runUrl}
                    label={`Run #${outcome.runId} auf GitHub`}
                    {native}
                    onError={warn}
                  />{/if}
                <button
                  type="button"
                  class="text-button"
                  onclick={() => {
                    const id = outcome?.runId ?? null;
                    closeModal();
                    tab = 'activity';
                    filter = 'all';
                    query = '';
                    expanded = id;
                  }}
                  >In Aktivität anzeigen<Icon name="arrow" size={13} /></button
                >
              {/if}
              {#if outcome.state === 'uncertain'}<button
                  type="button"
                  class="text-button"
                  onclick={checkStartStatus}
                  disabled={refreshing}
                  >Status prüfen<Icon name="refresh" size={12} /></button
                >{/if}
            </div>
          </div>{/if}
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary-button" onclick={closeModal}
          >{outcome ? 'Schließen' : 'Abbrechen'}</button
        ><button
          type="button"
          class="primary-button"
          onclick={() => void dispatch()}
          disabled={dispatching ||
            targetUncertain ||
            saving ||
            !!validation ||
            blocked ||
            outcome?.state === 'uncertain' ||
            outcome?.state === 'accepted'}
          >{dispatching
            ? demo
              ? 'Simuliert …'
              : 'Startet …'
            : demo
              ? 'Start simulieren'
              : 'Workflow starten'}<Icon name="play" size={14} /></button
        >
      </div>
    </form>
  </Modal>
{/if}
