<script lang="ts">
  import { onMount, tick } from 'svelte';
  import AppFooter from './lib/AppFooter.svelte';
  import AppHeader from './lib/AppHeader.svelte';
  import Icon from './lib/Icon.svelte';
  import RepositoryList from './lib/RepositoryList.svelte';
  import appPackage from '../package.json';
  const appVersion = appPackage.version;
  import UncertainStartHelp from './lib/UncertainStartHelp.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import UpdatePanel from './lib/UpdatePanel.svelte';
  import StartupSettings from './lib/StartupSettings.svelte';
  import { Updater } from './lib/updater.svelte';
  import NativeConnect from './lib/NativeConnect.svelte';
  import ConnectedAccounts from './lib/ConnectedAccounts.svelte';
  import ConnectPanel from './lib/ConnectPanel.svelte';
  import {
    accountTitle,
    readActiveAccount,
    rememberActiveAccount,
    restoreActiveAccount,
  } from './lib/accountSelection';
  import { bridge, native, observeSnapshots } from './lib/bridge';
  import { trapFocus } from './lib/focus';
  import {
    accountLabel,
    clockTime,
    errorMessage,
    repoLabel,
  } from './lib/format';
  import {
    defaultInputs,
    duration,
    fullRepo,
    repositoryActivity,
    historyRuns,
    HISTORY_LIMIT,
    isActive,
    RequestEpoch,
    safeGitHubUrl,
    statusLabel,
    targetKey,
    validateDispatch,
    visibleRuns,
    type ActivityFilter,
  } from './lib/model';
  import type {
    DemoScenario,
    DispatchOutcome,
    DispatchRequest,
    InputValue,
    Pin,
    Snapshot,
    Workflow,
  } from './lib/types';

  // Snapshots are replaced wholesale, never mutated: no deep proxy needed.
  let snapshot = $state.raw<Snapshot | null>(null);
  const demo = $derived(snapshot?.mode !== 'live');
  const updater = new Updater(native);
  const settingsTabs = [
    { id: 'accounts', label: 'Konten' },
    { id: 'repositories', label: 'Repositories' },
    { id: 'app', label: 'App' },
    { id: 'updates', label: 'Updates' },
  ] as const;
  type SettingsTab = (typeof settingsTabs)[number]['id'];
  let settingsTab = $state<SettingsTab>('accounts');
  let repoSettingsQuery = $state('');
  let demoAccountConnected = $state(false);
  let tab = $state<'repositories' | 'activity' | 'launch'>('repositories');
  let accountId = $state('');
  let accountSelectionNotice = $state('');
  let accountSelectionReady = false;
  let query = $state('');
  let filter = $state<ActivityFilter>('all');
  let favoriteIntent = $state(false);
  let expanded = $state<number | null>(null);
  let modal = $state<'settings' | 'dispatch' | 'connect' | null>(null);
  let selectedRepos = $state<string[]>([]);
  let scenario = $state<DemoScenario>('normal');
  let refreshing = $state(false);
  let saving = $state(false);
  let dispatching = $state(false);
  let error = $state('');
  let notice = $state('');
  let noticeTone = $state<'subtle' | 'warning' | 'danger'>('subtle');
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
  let searchInput = $state<HTMLInputElement>();
  let accountPicker = $state<HTMLSelectElement>();
  const viewEpoch = new RequestEpoch();
  const dialogEpoch = new RequestEpoch();

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
  /** Repository IDs the current snapshot has selected (persisted selection). */
  const savedSelection = $derived(
    snapshot?.repos.filter((repo) => repo.selected).map((repo) => repo.id) ??
      [],
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
  const targetUncertain = $derived(
    quarantinedTargets.has(targetKey(request('context'))),
  );

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
    closeModal();
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
      selectedRepos = savedSelection;
    } catch (cause) {
      dialogError = errorMessage(cause);
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
    void tick().then(() => accountPicker?.focus());
  }
  function repoName(id: string) {
    return repoLabel(snapshot, id);
  }
  function accountName(id: string) {
    return accountLabel(snapshot, id, native);
  }
  function showNotice(
    value: string,
    tone: 'subtle' | 'warning' | 'danger' = 'subtle',
  ) {
    notice = value;
    noticeTone = tone;
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
    try {
      await invoke('open_browser_installation');
    } catch (cause) {
      dialogError = errorMessage(cause);
    }
  }
  async function refreshRepositoryAccess() {
    if (mutationBusy) return;
    const ticket = viewEpoch.next();
    mutationBusy = true;
    dialogError = '';
    try {
      const value = await invoke<Snapshot>('refresh_repositories');
      if (viewEpoch.current(ticket)) {
        acceptSnapshot(value);
        selectedRepos = selectedRepos.filter((id) =>
          value.repos.some((repo) => repo.id === id),
        );
        if (value.stale)
          dialogError =
            value.message ??
            'Repository-Zugriff konnte nicht aktualisiert werden.';
      }
    } catch (cause) {
      if (viewEpoch.current(ticket)) dialogError = errorMessage(cause);
    } finally {
      if (viewEpoch.current(ticket)) mutationBusy = false;
    }
  }
  function closeModal() {
    dialogEpoch.invalidate();
    modal = null;
    dialogError = '';
    dialogNotice = '';
    outcome = null;
    dispatching = false;
    saving = false;
    mutationBusy = false;
  }
  function openSettings() {
    closeModal();
    selectedRepos = savedSelection;
    settingsTab = 'accounts';
    repoSettingsQuery = '';
    modal = 'settings';
  }
  function openUpdateSettings() {
    openSettings();
    settingsTab = 'updates';
  }
  function settingsTabKey(event: KeyboardEvent) {
    const direction =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const index = settingsTabs.findIndex((item) => item.id === settingsTab);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? settingsTabs.length - 1
          : (index + direction + settingsTabs.length) % settingsTabs.length;
    settingsTab = settingsTabs[next].id;
    (event.currentTarget as HTMLElement)
      .querySelectorAll<HTMLButtonElement>('[role=tab]')
      [next]?.focus();
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
    closeModal();
    modal = 'dispatch';
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
  async function saveSettings() {
    if (mutationBusy) return;
    mutationBusy = true;
    const ticket = dialogEpoch.next();
    viewEpoch.invalidate();
    refreshing = false;
    dialogError = '';
    try {
      const value = await bridge.selectRepos(selectedRepos);
      if (dialogEpoch.current(ticket)) {
        acceptSnapshot(value);
        closeModal();
        showNotice('Repository-Auswahl gespeichert.');
      }
    } catch (cause) {
      if (dialogEpoch.current(ticket)) dialogError = errorMessage(cause);
    } finally {
      if (dialogEpoch.current(ticket)) mutationBusy = false;
    }
  }
  async function changeScenario(value: DemoScenario) {
    const ticket = dialogEpoch.next();
    viewEpoch.invalidate();
    refreshing = false;
    scenario = value;
    dialogError = '';
    try {
      const data = await bridge.setDemoScenario(value);
      if (dialogEpoch.current(ticket)) snapshot = data;
    } catch (cause) {
      if (dialogEpoch.current(ticket)) dialogError = errorMessage(cause);
    }
  }
  async function resetDemo() {
    const ticket = dialogEpoch.next();
    viewEpoch.invalidate();
    refreshing = false;
    mutationBusy = true;
    try {
      const value = await bridge.resetDemo();
      if (dialogEpoch.current(ticket)) {
        acceptSnapshot(value);
        accountId = '';
        scenario = 'normal';
        quarantinedTargets = new Set();
        selectedRepos = savedSelection;
        closeModal();
        showNotice(
          'Demo zurückgesetzt. Lokale Vorlagen und Auswahl wurden zurückgesetzt.',
        );
      }
    } catch (cause) {
      if (dialogEpoch.current(ticket)) dialogError = errorMessage(cause);
    } finally {
      if (dialogEpoch.current(ticket)) mutationBusy = false;
    }
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && modal) closeModal();
    if (
      event.key === '/' &&
      !modal &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLSelectElement)
    ) {
      event.preventDefault();
      searchInput?.focus();
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

    <div class="toolbar">
      {#if native}
        <div
          class="active-account-status"
          role="status"
          aria-label="Aktives Konto"
          title={accountId
            ? `Aktives Konto: ${accountName(accountId)}`
            : 'Kein aktives Konto · Auswahl in den Einstellungen'}
        >
          <Icon name="github" size={14} />
          <span
            >{accountId ? accountName(accountId) : 'Kein aktives Konto'}</span
          >
        </div>
      {:else}
        <label class="account-picker"
          ><span class="avatar"
            >{accountId === 'demo-work'
              ? 'T'
              : accountId === 'demo-personal'
                ? 'D'
                : 'A'}</span
          ><select
            aria-label="Account auswählen"
            bind:this={accountPicker}
            value={accountId}
            onchange={(event) => changeAccount(event.currentTarget.value)}
            ><option value="">Alle Accounts</option
            >{#each snapshot?.accounts ?? [] as account}<option
                value={account.id}>{account.login}</option
              >{/each}</select
          ><Icon name="down" size={13} /></label
        >
      {/if}
      <div class="toolbar-actions">
        <span class="repo-count">{repos.length} Repos</span><button
          class:spinning={refreshing}
          class="icon-button"
          aria-label="Aktualisieren"
          title={demo
            ? 'Demo-Status aktualisieren'
            : 'GitHub-Status aktualisieren'}
          onclick={refresh}
          disabled={refreshing || !snapshot}
          ><Icon name="refresh" size={16} /></button
        ><button
          class="icon-button"
          aria-label="Einstellungen"
          title="Einstellungen"
          onclick={openSettings}
          disabled={!snapshot}><Icon name="settings" size={17} /></button
        >
      </div>
    </div>

    <nav class="tabs" aria-label="Ansicht">
      <button
        class:active={tab === 'repositories'}
        aria-current={tab === 'repositories' ? 'page' : undefined}
        onclick={() => {
          tab = 'repositories';
          query = '';
        }}><Icon name="repo" size={16} />Repositories</button
      >
      <button
        class:active={tab === 'activity'}
        aria-current={tab === 'activity' ? 'page' : undefined}
        onclick={() => {
          tab = 'activity';
          query = '';
        }}
        ><Icon name="activity" size={17} />Aktivität{#if activeRuns}<span
            class="tab-count">{activeRuns}</span
          >{/if}</button
      >
      <button
        class:active={tab === 'launch'}
        aria-current={tab === 'launch' ? 'page' : undefined}
        onclick={() => {
          tab = 'launch';
          query = '';
        }}><Icon name="heart" size={16} />Favoriten</button
      >
    </nav>

    <div class="content">
      <label class="search-field"
        ><Icon name="search" size={17} /><input
          bind:this={searchInput}
          aria-label={tab === 'activity'
            ? 'Aktivität durchsuchen'
            : tab === 'repositories'
              ? 'Repositories durchsuchen'
              : 'Workflows durchsuchen'}
          placeholder={tab === 'activity'
            ? 'Repository, Workflow oder Branch suchen …'
            : tab === 'repositories'
              ? 'Repository oder Action suchen …'
              : 'Favoriten und Workflows suchen …'}
          bind:value={query}
        />{#if query}<button
            class="icon-button small"
            aria-label="Suche leeren"
            onclick={() => (query = '')}><Icon name="close" size={14} /></button
          >{:else}<kbd>/</kbd>{/if}</label
      >

      {#if updater.info && !demo}<div
          class="alert subtle notice-banner"
          role="status"
        >
          <Icon name="refresh" size={16} /><span
            >RepoTray {updater.info.version} verfügbar</span
          ><button class="text-button" onclick={openUpdateSettings}
            >Update ansehen</button
          >
        </div>{/if}
      {#if snapshot?.stale || snapshot?.connectivity === 'forbidden'}<div
          class="alert warning"
          role="status"
        >
          <Icon name="warning" size={16} /><span
            >{snapshot.message ?? 'Demo-Status nicht verfügbar.'}</span
          >
        </div>{/if}
      {#if error}<div class="alert danger" role="alert">
          <Icon name="warning" size={16} /><span>{error}</span>
        </div>{/if}
      {#if notice}<div
          class={`alert ${noticeTone} notice-banner`}
          role="status"
        >
          <Icon
            name={noticeTone === 'subtle' ? 'check' : 'warning'}
            size={16}
          /><span>{notice}</span><button
            class="icon-button small"
            aria-label="Meldung schließen"
            onclick={() => (notice = '')}
            ><Icon name="close" size={13} /></button
          >
        </div>{/if}

      {#if !snapshot}
        <div class="empty-state">
          <span class="empty-icon"><Icon name="tray" size={26} /></span>
          <h2>
            {error ? 'Demo nicht geladen' : 'Workflows werden sortiert …'}
          </h2>
          <p>
            {error
              ? 'Starte die Anwendung neu, um den lokalen Demo-Stand zu laden.'
              : 'Dein Überblick ist gleich bereit.'}
          </p>
        </div>
      {:else if tab === 'repositories'}
        {#if pins.length}
          <section
            class="repository-favorites"
            aria-label="Angeheftete Favoriten"
          >
            <div class="section-heading pinned-heading">
              <h2><Icon name="pin" size={13} />Favoriten</h2>
              <span>{pins.length} angeheftet</span>
            </div>
            <div class="pinned-list">
              {#each pins as pin (pin.id)}
                {@const uncertain = quarantinedTargets.has(targetKey(pin))}
                <article class="pinned-action" class:uncertain>
                  <button
                    class="pinned-copy"
                    onclick={() => openDispatch(pin)}
                    aria-label={`Favorit ${pin.label} konfigurieren`}
                    title={`${pin.label} · ${repoName(pin.repoId)} · ${pin.ref} · ${accountName(pin.accountId)}`}
                    disabled={dispatching}
                  >
                    <strong>{pin.label}</strong>
                    <small
                      ><span>{repoName(pin.repoId)}</span><span
                        class="pinned-ref">· {pin.ref}</span
                      ></small
                    >
                  </button>
                  {#if uncertain}<span
                      class="pinned-warning"
                      title="Startstatus ungeklärt · Öffnen, um den Status zu prüfen"
                      role="img"
                      aria-label="Startstatus ungeklärt"
                      ><Icon name="warning" size={14} /></span
                    >{/if}
                  <button
                    class="icon-button pinned-remove"
                    aria-label={`Favorit ${pin.label} entfernen`}
                    title="Favorit entfernen"
                    disabled={mutationBusy || dispatching}
                    onclick={() => deletePin(pin.id)}
                    ><Icon name="heart" size={15} /></button
                  >
                  <button
                    class="action-start pinned-start"
                    onclick={() => launchPin(pin)}
                    disabled={dispatching ||
                      (pin.quickStart && (blocked || uncertain))}
                    title={pin.quickStart
                      ? 'Mit gespeicherten Parametern starten'
                      : 'Gespeicherte Parameter öffnen und bestätigen'}
                  >
                    <Icon
                      name={pin.quickStart ? 'bolt' : 'play'}
                      size={12}
                    />{pin.quickStart ? 'Schnellstart' : 'Öffnen'}
                  </button>
                </article>
              {/each}
            </div>
          </section>
        {/if}
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
        {#if !repoGroups.length}<div class="empty-state">
            <span class="empty-icon"><Icon name="repo" size={25} /></span>
            <h2>
              {native && !accountId
                ? snapshot.accounts.length
                  ? 'Wähle ein aktives Konto'
                  : 'Verbinde dein GitHub-Konto'
                : query
                  ? 'Keine passenden Repositories'
                  : 'Noch keine Repositories ausgewählt'}
            </h2>
            <p>
              {native && !accountId
                ? accountSelectionNotice ||
                  'Wähle Konto und Repositories in den Einstellungen.'
                : query
                  ? 'Suche nach einem Repository oder einer Action.'
                  : 'Wähle Repositories in den Einstellungen aus.'}
            </p>
            {#if query}<button class="text-button" onclick={() => (query = '')}
                >Suche leeren<Icon name="close" size={14} /></button
              >
            {:else}<button class="text-button" onclick={openSettings}
                >{native && !accountId
                  ? 'Konto in Einstellungen wählen'
                  : 'Repositories auswählen'}<Icon
                  name="arrow"
                  size={14}
                /></button
              >{/if}
          </div>{/if}
      {:else if tab === 'activity'}
        <div class="filters" aria-label="Aktivitätsfilter">
          {#each [{ id: 'all', label: 'Alle' }, { id: 'active', label: 'Aktiv' }, { id: 'failed', label: 'Fehlgeschlagen' }, { id: 'recent', label: 'Abgeschlossen' }] as item}<button
              class:chosen={filter === item.id}
              aria-pressed={filter === item.id}
              onclick={() => (filter = item.id as ActivityFilter)}
              >{item.label}{#if item.id === 'active'}<span>{activeRuns}</span
                >{:else if item.id === 'failed'}<span>{failedRuns}</span
                >{/if}</button
            >{/each}
        </div>
        <div class="section-heading">
          <h2>
            {filter === 'active'
              ? 'Aktive Runs'
              : filter === 'failed'
                ? 'Fehlgeschlagene Runs'
                : filter === 'recent'
                  ? 'Abgeschlossene Runs'
                  : 'Letzte Aktivitäten'}
          </h2>
          <span>{runs.length} {runs.length === 1 ? 'Run' : 'Runs'}</span>
        </div>
        <p class="history-note">
          <span class="group-live-dot"></span>Offene Runs werden automatisch
          aktualisiert.<br />Bis zu {HISTORY_LIMIT} abgeschlossene Runs bleiben im
          Verlauf.
        </p>
        <div class="run-list history-list">
          {#each runs as run, index (`${run.repoId}:${run.id}`)}
            {#if filter === 'all' && !isActive(run) && (index === 0 || isActive(runs[index - 1]))}<div
                class="list-divider"
              >
                <span>Zuletzt abgeschlossen</span>
              </div>{/if}
            <article class="run" class:expanded={expanded === run.id}>
              <button
                class="run-button"
                aria-expanded={expanded === run.id}
                aria-label={`${run.name} · ${repoName(run.repoId)} · ${statusLabel(run)}`}
                onclick={() => (expanded = expanded === run.id ? null : run.id)}
              >
                <span
                  class="status-icon"
                  class:running={run.status === 'in_progress'}
                  class:queued={run.status === 'queued'}
                  class:waiting={run.status === 'waiting'}
                  class:success={run.conclusion === 'success'}
                  class:failure={run.conclusion === 'failure'}
                  ><Icon
                    name={run.status === 'in_progress'
                      ? 'activity'
                      : run.status === 'waiting'
                        ? 'pause'
                        : run.status === 'queued'
                          ? 'clock'
                          : run.conclusion === 'success'
                            ? 'check'
                            : 'close'}
                    size={16}
                  /></span
                >
                <span class="run-main"
                  ><span class="run-name"
                    >{run.name}<span class="run-number">#{run.id}</span></span
                  ><span class="run-repo">{repoName(run.repoId)}</span><span
                    class="run-branch"
                    ><Icon name="branch" size={11} />{run.branch}<span
                      class="meta-dot">·</span
                    ><span>{duration(run)}</span></span
                  ></span
                >
                <span class="run-tail"
                  ><span
                    class="status-label"
                    class:running={run.status === 'in_progress'}
                    class:failure={run.conclusion === 'failure'}
                    >{statusLabel(run)}</span
                  ><Icon name="chevron" size={14} /></span
                >
              </button>
              {#if expanded === run.id}<div class="run-details">
                  <div>
                    <span>Account</span><strong
                      >{accountName(
                        snapshot.repos.find((repo) => repo.id === run.repoId)
                          ?.accountId ?? '',
                      )}</strong
                    >
                  </div>
                  <div>
                    <span>Aktualisiert</span><strong
                      >{clockTime(run.updatedAt)}{demo
                        ? ' · Demo-Zeit'
                        : ''}</strong
                    >
                  </div>
                  <div>
                    <span>Ergebnis</span><strong>{statusLabel(run)}</strong>
                  </div>
                  {#if safeGitHubUrl(run.htmlUrl)}<a
                      class="detail-link"
                      href={safeGitHubUrl(run.htmlUrl)!}
                      onclick={(event) => {
                        if (native) {
                          event.preventDefault();
                          void invoke('open_run', {
                            url: run.htmlUrl,
                          }).catch((cause) =>
                            showNotice(errorMessage(cause), 'warning'),
                          );
                        }
                      }}
                      target="_blank"
                      rel="noopener noreferrer"
                      >Auf GitHub ansehen<Icon name="external" size={13} /></a
                    >{:else}<button
                      class="detail-link"
                      disabled
                      title="Demo-Runs haben keinen GitHub-Link"
                      >GitHub-Link in Demo nicht verfügbar<Icon
                        name="external"
                        size={13}
                      /></button
                    >{/if}
                </div>{/if}
            </article>
          {:else}<div class="empty-state">
              <span class="empty-icon"><Icon name="activity" size={25} /></span>
              <h2>
                {native && !accountId
                  ? snapshot?.accounts.length
                    ? 'Wähle ein aktives Konto'
                    : 'Verbinde dein GitHub-Konto'
                  : repos.length
                    ? 'Hier ist gerade Ruhe'
                    : 'Noch keine Repositories ausgewählt'}
              </h2>
              <p>
                {native && !accountId
                  ? accountSelectionNotice ||
                    'Öffne die Einstellungen und wähle dort Konto und Anmeldequelle. Repository-Starts bleiben an ihr Konto gebunden.'
                  : query
                    ? 'Für diese Suche gibt es keine Runs.'
                    : repos.length
                      ? 'Für diesen Filter gibt es keine Runs.'
                      : 'Wähle Repositories in den Einstellungen aus.'}
              </p>
              {#if native && !accountId}<button
                  class="text-button"
                  onclick={openSettings}
                  >Konto in Einstellungen wählen<Icon
                    name="arrow"
                    size={14}
                  /></button
                >
              {:else if !repos.length}<button
                  class="text-button"
                  onclick={openSettings}
                  >Repositories auswählen<Icon name="arrow" size={14} /></button
                >{/if}
            </div>{/each}
        </div>
      {:else}
        <div class="section-heading launch-heading">
          <h2><Icon name="heart" size={14} />Deine Favoriten</h2>
          <span>{pins.length} gespeichert</span>
        </div>
        <div class="pin-list" class:has-pins={pins.length > 0}>
          {#each pins as pin (pin.id)}
            <article class="pin-card">
              <div class="pin-content">
                <div class="pin-title-line">
                  <h3>{pin.label}</h3>
                  {#if quarantinedTargets.has(targetKey(pin))}<span
                      class="pin-ref"
                      ><Icon name="branch" size={11} />{pin.ref}</span
                    >{/if}
                </div>
                <p class="pin-repo">
                  {repoName(pin.repoId)}<span
                    class="pin-account"
                    title={`Konto ${accountName(pin.accountId)}`}
                  >
                    · {accountName(pin.accountId)}</span
                  >
                </p>
                <div class="pin-meta">
                  {#if quarantinedTargets.has(targetKey(pin))}<UncertainStartHelp
                      id={`uncertain-help-${pin.id}`}
                      quickStart={pin.quickStart}
                      {demo}
                    />
                  {:else}<span class="pin-ref"
                      ><Icon name="branch" size={11} />{pin.ref}</span
                    ><span class="pin-mode" class:quick={pin.quickStart}
                      >{pin.quickStart
                        ? 'Schnellstart aktiv'
                        : 'Mit Bestätigung'}</span
                    >{/if}
                </div>
              </div>
              <div class="pin-actions">
                <button
                  class="pin-start"
                  onclick={() => launchPin(pin)}
                  disabled={dispatching ||
                    (pin.quickStart &&
                      (blocked || quarantinedTargets.has(targetKey(pin))))}
                  ><Icon
                    name={pin.quickStart ? 'bolt' : 'play'}
                    size={13}
                  />{pin.quickStart ? 'Schnellstart' : 'Öffnen'}</button
                >
                {#if pin.quickStart}<button
                    class="icon-button pin-configure"
                    aria-label={`Vorlage ${pin.label} konfigurieren`}
                    title="Konfigurieren"
                    onclick={() => openDispatch(pin)}
                    disabled={dispatching}
                    ><Icon name="settings" size={14} /></button
                  >{/if}
                <button
                  class="icon-button small delete-pin"
                  aria-label={`Vorlage ${pin.label} entfernen`}
                  title="Vorlage entfernen"
                  onclick={() => deletePin(pin.id)}
                  disabled={mutationBusy}
                  ><Icon name="trash" size={14} /></button
                >
              </div>
            </article>
          {:else}{#if !query.trim()}<div class="empty-pins">
                <Icon name="pin" size={18} /><span
                  >Deine häufigen Starts, einen Klick näher.<small
                    >Speichere einen Workflow als Vorlage.</small
                  ></span
                >
              </div>{/if}{/each}
        </div>
        <div class="section-heading workflow-heading">
          <h2>Workflow auswählen</h2>
          <button
            class="text-button"
            onclick={() => openDispatch()}
            disabled={!repos.length}
            >Neu konfigurieren<Icon name="plus" size={13} /></button
          >
        </div>
        <div class="workflow-list">
          {#each launchRepos as repo}<div class="repo-group">
              <div class="repo-heading">
                <Icon name="repo" size={13} /><span>{fullRepo(repo)}</span
                >{#if repo.permission !== 'write'}<span class="read-badge"
                    >Nur Lesen</span
                  >{/if}
              </div>
              {#each matchedWorkflows(repo.id) as workflow}<button
                  class="workflow-item"
                  onclick={() => openDispatch(undefined, workflow)}
                  ><span class="workflow-copy"
                    ><strong>{workflow.name}</strong><small
                      >{workflow.dispatch
                        ? `Manueller Start · ${repo.defaultBranch}`
                        : 'Kein workflow_dispatch'}</small
                    ></span
                  ><Icon
                    name={workflow.dispatch && repo.permission === 'write'
                      ? 'chevron'
                      : 'shield'}
                    size={15}
                  /></button
                >{/each}
            </div>{/each}
        </div>
        {#if query.trim() && !pins.length && !launchRepos.length}<div
            class="empty-state"
          >
            <Icon name="search" size={26} />
            <h2>Keine passenden Vorlagen oder Workflows</h2>
            <p>Versuche einen anderen Namen, Owner oder Repository.</p>
            <button class="text-button" onclick={() => (query = '')}
              >Suche leeren<Icon name="close" size={14} /></button
            >
          </div>{/if}
        {#if !repos.length}<div class="empty-state">
            <Icon name="repo" size={26} />
            <h2>
              {native && !accountId
                ? 'Wähle ein aktives Konto'
                : 'Wähle deine Repositories'}
            </h2>
            <p>
              {native && !accountId
                ? 'Konto und Anmeldequelle findest du in den Einstellungen.'
                : 'Deine Auswahl erscheint hier.'}
            </p>
            <button class="text-button" onclick={openSettings}
              >Einstellungen öffnen<Icon name="arrow" size={14} /></button
            >
          </div>{/if}
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

{#if modal}
  <div class="modal-backdrop" role="presentation">
    {#key modal}<div
        class="modal"
        class:settings-modal={modal === 'settings'}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabindex="-1"
        use:trapFocus
      >
        <div class="modal-heading">
          <div>
            <span class="eyebrow">REPOTRAY · {demo ? 'DEMO' : 'GITHUB'}</span>
            <h2 id="modal-title">
              {modal === 'settings'
                ? 'Dein Workspace'
                : modal === 'connect'
                  ? 'GitHub verbinden'
                  : 'Workflow starten'}
            </h2>
          </div>
          <button
            class="icon-button"
            aria-label="Dialog schließen"
            onclick={closeModal}><Icon name="close" size={19} /></button
          >
        </div>
        {#if modal === 'settings'}
          <div
            class="settings-tabs"
            role="tablist"
            tabindex="-1"
            aria-label="Einstellungsbereiche"
            onkeydown={settingsTabKey}
          >
            {#each settingsTabs as item}
              <button
                id={`settings-tab-${item.id}`}
                role="tab"
                aria-selected={settingsTab === item.id}
                aria-controls="settings-panel"
                tabindex={settingsTab === item.id ? 0 : -1}
                onclick={() => (settingsTab = item.id)}
                >{item.label}{#if item.id === 'updates' && updater.info}<span
                    class="tab-update-dot"
                    aria-label="Update verfügbar"
                  ></span>{/if}</button
              >
            {/each}
          </div>
          <div
            class="modal-body"
            id="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${settingsTab}`}
            tabindex="0"
          >
            {#if settingsTab === 'accounts'}
              {#if native}
                <section
                  class="active-account-settings"
                  aria-labelledby="active-account-heading"
                >
                  <h3 id="active-account-heading">Aktives Konto</h3>
                  <p>
                    Für Ansicht und neue Starts. Deine Kontoauswahl gilt sofort
                    und wird gemerkt.
                  </p>
                  <label class="field">
                    <span>Login und Anmeldequelle</span>
                    <select
                      aria-label="Aktives Konto auswählen"
                      bind:this={accountPicker}
                      value={accountId}
                      disabled={mutationBusy || !snapshot?.accounts.length}
                      onchange={(event) =>
                        changeAccount(event.currentTarget.value)}
                    >
                      <option value="" disabled
                        >{snapshot?.accounts.length
                          ? 'Aktives Konto auswählen'
                          : 'Noch kein Konto verbunden'}</option
                      >
                      {#each snapshot?.accounts ?? [] as account}<option
                          value={account.id}>{accountTitle(account)}</option
                        >{/each}
                    </select>
                  </label>
                  {#if accountSelectionNotice}<p
                      class="account-selection-notice"
                      role="status"
                    >
                      {accountSelectionNotice}
                    </p>{/if}
                  {#if !snapshot?.accounts.length}<button
                      class="secondary-button"
                      onclick={() => {
                        closeModal();
                        modal = 'connect';
                      }}
                      >GitHub-Konto verbinden<Icon
                        name="plus"
                        size={14}
                      /></button
                    >{/if}
                  <ConnectedAccounts
                    accounts={snapshot?.accounts ?? []}
                    activeAccountId={accountId}
                    disabled={mutationBusy}
                    onUse={changeAccount}
                  />
                </section>
              {/if}
              <div class="settings-section">
                <h3>Verbindung</h3>
                <div class="connection-card">
                  <Icon name="github" size={22} />
                  <div>
                    <strong
                      >{demo
                        ? 'Du bist im Demo-Modus'
                        : `${snapshot?.accounts.length ?? 0} Konten verbunden`}</strong
                    >
                    <p>
                      {demo
                        ? 'Kein Account verbunden. Keine echten Starts.'
                        : 'Tokens bleiben im Betriebssystem-Tresor.'}
                    </p>
                  </div>
                  <button
                    class="text-button"
                    onclick={() => {
                      closeModal();
                      modal = 'connect';
                    }}>Einrichten<Icon name="chevron" size={13} /></button
                  >
                </div>
              </div>
              {#if demo}<div class="settings-section">
                  <label class="field"
                    ><span>Demo-Szenario</span><select
                      aria-label="Demo-Szenario"
                      value={scenario}
                      onchange={(event) =>
                        changeScenario(
                          event.currentTarget.value as DemoScenario,
                        )}
                      ><option value="normal">Normal · lokale Simulation</option
                      ><option value="offline">Offline · letzter Stand</option
                      ><option value="forbidden"
                        >Keine Berechtigung · 403</option
                      ><option value="uncertain"
                        >Unklare Antwort · Start gesperrt</option
                      ></select
                    ></label
                  >
                  <p class="field-help">
                    Szenarien verwenden ausschließlich lokale Demo-Daten.
                  </p>
                  <button
                    class="reset-button"
                    onclick={resetDemo}
                    disabled={mutationBusy}
                    ><Icon name="refresh" size={13} />Demo zurücksetzen<span
                      >Setzt auch Vorlagen & Auswahl zurück</span
                    ></button
                  >
                </div>
              {/if}
              {#if !demo}
                <p class="field-help account-semantics">
                  Das aktive Konto steuert Ansicht und neue Starts. Andere
                  Konten bleiben verbunden; ihre ausgewählten Repositories
                  werden weiter beobachtet. Ein fehlgeschlagener Zugriff
                  wechselt nicht automatisch das Konto.
                </p>
                {#each snapshot?.accounts ?? [] as account}<button
                    class="text-button"
                    disabled={mutationBusy}
                    onclick={() => disconnectAccount(account.id)}
                    >{accountName(account.id)} trennen</button
                  >{/each}
              {/if}
            {:else if settingsTab === 'repositories'}
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
                  bind:value={repoSettingsQuery}
                /></label
              >
              <p class="field-help">
                {selectedRepos.length} Repositories ausgewählt
              </p>
              <div class="repo-selection">
                {#each snapshot?.accounts ?? [] as account}<div
                    class="selection-account"
                  >
                    <span class="mini-avatar"
                      >{account.login[0].toUpperCase()}</span
                    >{account.login}<span>{account.label}</span>
                  </div>
                  {#each snapshot?.repos.filter((repo) => repo.accountId === account.id && fullRepo(repo)
                        .toLowerCase()
                        .includes(repoSettingsQuery
                            .trim()
                            .toLowerCase())) ?? [] as repo}<label
                      class="repo-checkbox"
                      ><input
                        type="checkbox"
                        value={repo.id}
                        checked={selectedRepos.includes(repo.id)}
                        onchange={(event) => {
                          selectedRepos = event.currentTarget.checked
                            ? [...selectedRepos, repo.id]
                            : selectedRepos.filter((id) => id !== repo.id);
                        }}
                      /><span
                        ><strong>{fullRepo(repo)}</strong><small
                          >{repo.permission === 'write'
                            ? 'Actions · Schreibzugriff'
                            : repo.permission === 'denied'
                              ? 'Actions · Kein Zugriff'
                              : 'Actions · Nur Lesen'}</small
                        ></span
                      ><Icon name="repo" size={15} /></label
                    >{/each}{/each}
              </div>
              {#if !demo && snapshot?.accounts.some( (account) => account.id.startsWith('github-device-') )}
                <div class="settings-section installation-access">
                  <button
                    class="text-button"
                    disabled={mutationBusy}
                    onclick={manageBrowserRepositories}
                    >Repository-Freigabe auf GitHub ändern<Icon
                      name="external"
                      size={14}
                    /></button
                  >
                  <p class="field-help">
                    Wähle bei der App-Installation einzelne oder alle
                    Repositories. Organisationen können eine Freigabe oder
                    aktive SSO-Sitzung verlangen. Autorisierung und Installation
                    sind getrennte Schritte.
                  </p>
                  <button
                    class="secondary-button"
                    disabled={mutationBusy}
                    onclick={refreshRepositoryAccess}
                    >Repository-Liste aktualisieren<Icon
                      name="refresh"
                      size={14}
                    /></button
                  >
                </div>
              {/if}
            {:else if settingsTab === 'app'}
              <StartupSettings {native} />
            {:else}
              <UpdatePanel
                currentVersion={appVersion}
                {native}
                info={updater.info}
                phase={updater.phase}
                progress={updater.progress}
                error={updater.message}
                checkedAt={updater.checkedAt}
                onCheck={() => updater.check()}
                onDownload={updater.download}
                onInstall={updater.install}
              />
            {/if}
          </div>
          {#if dialogError}<div class="dialog-alert danger" role="alert">
              {dialogError}
            </div>{/if}
          <div class="modal-actions">
            <button class="secondary-button" onclick={closeModal}
              >{settingsTab === 'updates' || settingsTab === 'app'
                ? 'Schließen'
                : 'Abbrechen'}</button
            >{#if settingsTab === 'repositories'}<button
                class="primary-button"
                onclick={saveSettings}
                disabled={mutationBusy}
                >{mutationBusy ? 'Speichert …' : 'Auswahl speichern'}<Icon
                  name="check"
                  size={15}
                /></button
              >{/if}
          </div>
        {:else if modal === 'connect'}
          {#if native}<NativeConnect
              accounts={snapshot?.accounts ?? []}
              activeAccountId={accountId}
              onSelectAccount={changeAccount}
              onConnected={connectedNative}
              onClose={closeModal}
            />{:else}<ConnectPanel
              onConnected={connectedDemo}
              onClose={closeModal}
              onSettings={openSettings}
            />{/if}
        {:else}
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
                    >{/if}{#each workflows as workflow}<option
                      value={workflow.id}
                      >{workflow.name}{!workflow.dispatch
                        ? ' · kein manueller Start'
                        : ''}</option
                    >{/each}</select
                ></label
              >{#if chosenWorkflow}<div class="workflow-path">
                  {chosenWorkflow.path}
                </div>{/if}<label class="field"
                ><span>Branch oder Tag<span class="required">*</span></span
                ><select
                  aria-label="Branch oder Tag"
                  value={ref}
                  onchange={(event) => changeRef(event.currentTarget.value)}
                  disabled={dispatching}
                  >{#each chosenWorkflow?.refs ?? [] as branch}<option
                      value={branch}
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
                      >{input.label}{#if input.required}<span class="required"
                          >*</span
                        >{/if}<small>{input.type}</small></span
                    >{#if input.type === 'choice' || input.type === 'environment'}<select
                        aria-label={input.label}
                        value={String(inputs[input.name] ?? '')}
                        onchange={(event) =>
                          setInput(input.name, event.currentTarget.value)}
                        disabled={dispatching}
                        >{#if !input.required}<option value=""
                            >Nicht gesetzt</option
                          >{/if}{#each input.options as option}<option
                            value={option}>{option}</option
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
                        >Startet diese Vorlage ohne erneute Bestätigung. Nur für
                        diese Auswahl.</small
                      ></span
                    ></label
                  >
                  <p class="field-help">
                    Speichert Account, Repository, Workflow, Ref und nicht
                    geheime Eingaben lokal.
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
                      Für dieses Ziel fehlt die Startbestätigung. Ein erneuter
                      Start bleibt gesperrt. Prüfe zuerst den Status.
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
                      {#if safeGitHubUrl(outcome.htmlUrl ?? '')}<a
                          class="detail-link"
                          href={safeGitHubUrl(outcome.htmlUrl ?? '')!}
                          target="_blank"
                          rel="noopener noreferrer"
                          onclick={(event) => {
                            if (native) {
                              event.preventDefault();
                              void invoke('open_run', {
                                url: outcome?.htmlUrl,
                              }).catch((cause) =>
                                showNotice(errorMessage(cause), 'warning'),
                              );
                            }
                          }}
                          >Run #{outcome.runId} auf GitHub<Icon
                            name="external"
                            size={13}
                          /></a
                        >{/if}
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
                        >In Aktivität anzeigen<Icon
                          name="arrow"
                          size={13}
                        /></button
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
              <button
                type="button"
                class="secondary-button"
                onclick={closeModal}
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
        {/if}
      </div>{/key}
  </div>
{/if}
