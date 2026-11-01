<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ActivityView from './lib/ActivityView.svelte';
  import AppFooter from './lib/AppFooter.svelte';
  import AppHeader from './lib/AppHeader.svelte';
  import ConnectPanel from './lib/ConnectPanel.svelte';
  import EmptyState from './lib/EmptyState.svelte';
  import Icon from './lib/Icon.svelte';
  import LaunchView from './lib/LaunchView.svelte';
  import Modal from './lib/Modal.svelte';
  import NativeConnect from './lib/NativeConnect.svelte';
  import NoticeBanner from './lib/NoticeBanner.svelte';
  import PinnedFavorites from './lib/PinnedFavorites.svelte';
  import RepositoryList from './lib/RepositoryList.svelte';
  import RunLink from './lib/RunLink.svelte';
  import SearchField from './lib/SearchField.svelte';
  import SettingsDialog, {
    type SettingsTab,
  } from './lib/SettingsDialog.svelte';
  import StatusBanners from './lib/StatusBanners.svelte';
  import Toolbar from './lib/Toolbar.svelte';
  import ViewTabs, { type ViewTab } from './lib/ViewTabs.svelte';
  import appPackage from '../package.json';
  import { bridge, native, observeSnapshots } from './lib/bridge';
  import { accountLabel, errorMessage, repoLabel } from './lib/format';
  import {
    defaultInputs,
    fullRepo,
    historyRuns,
    repositoryActivity,
    RequestEpoch,
    safeGitHubUrl,
    targetKey,
    visibleRuns,
    type ActivityFilter,
    validateDispatch,
  } from './lib/model';
  import { Panel } from './lib/panel.svelte';
  import { pinRequest } from './lib/pins';
  import type {
    DispatchOutcome,
    DispatchRequest,
    DispatchTarget,
    InputValue,
    Pin,
    Snapshot,
    Workflow,
  } from './lib/types';
  import { Updater } from './lib/updater.svelte';

  const appVersion = appPackage.version;
  const panel = new Panel({ bridge, native, observe: observeSnapshots });
  const updater = new Updater(native);
  const snapshot = $derived(panel.snapshot);
  const demo = $derived(panel.demo);
  const accountId = $derived(panel.accountId);
  const repos = $derived(panel.repos);
  const blocked = $derived(panel.blocked);

  type ModalKind = 'settings' | 'dispatch' | 'connect';
  let modal = $state<ModalKind | null>(null);
  /** Element that opened the first of possibly chained dialogs. */
  let opener: HTMLElement | null = null;
  /** Tab the settings dialog opens on. */
  let settingsTab = $state<SettingsTab>('accounts');
  let demoAccountConnected = $state(false);
  let tab = $state<ViewTab>('repositories');
  let query = $state('');
  let filter = $state<ActivityFilter>('all');
  let expanded = $state<number | null>(null);
  let searchField = $state<ReturnType<typeof SearchField>>();
  let toolbar = $state<ReturnType<typeof Toolbar>>();

  // Start dialog form state.
  let favoriteIntent = $state(false);
  let dialogError = $state('');
  let dialogNotice = $state('');
  let dialogNoticeTone = $state<'subtle' | 'warning'>('subtle');
  let outcome = $state<DispatchOutcome | null>(null);
  let repoId = $state('');
  let workflowId = $state<number>(0);
  let ref = $state('main');
  let inputs = $state<Record<string, InputValue>>({});
  let pinLabel = $state('');
  let pinQuickStart = $state(false);
  let editingPinId = $state<string | null>(null);
  let outcomeBox = $state<HTMLElement>();
  let errorBox = $state<HTMLElement>();
  /** Bumped whenever the dialog's target or lifetime changes. */
  const dialogEpoch = new RequestEpoch();

  const needle = $derived(query.trim().toLowerCase());
  const view = $derived(panel.viewSnapshot);
  const runs = $derived(
    view ? historyRuns(view, accountId, query, filter) : [],
  );
  const repoGroups = $derived(
    view ? repositoryActivity(view, accountId, query) : [],
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
        (!needle ||
          `${pin.label} ${repoName(pin.repoId)}`
            .toLowerCase()
            .includes(needle)),
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
  const target = $derived<DispatchTarget>({
    accountId: chosenRepo?.accountId ?? '',
    repoId,
    workflowId,
    ref,
  });
  const validation = $derived(
    snapshot && chosenRepo && chosenWorkflow
      ? validateDispatch(snapshot, request('validation'))
      : 'Wähle Repository und Workflow.',
  );
  const targetUncertain = $derived(panel.starts.isQuarantined(target));
  /** A start for this target is running, from this dialog or a quick start. */
  const starting = $derived(panel.starts.isRunning(target));

  function matchedWorkflows(id: string) {
    return (
      snapshot?.workflows.filter(
        (workflow) =>
          workflow.repoId === id &&
          (!needle ||
            `${workflow.name} ${repoName(id)}`.toLowerCase().includes(needle)),
      ) ?? []
    );
  }
  function repoName(id: string) {
    return repoLabel(snapshot, id);
  }
  function accountName(id: string) {
    return accountLabel(snapshot, id, native);
  }
  function repoAccountName(id: string) {
    return accountName(
      snapshot?.repos.find((repo) => repo.id === id)?.accountId ?? '',
    );
  }
  function clearQuery() {
    query = '';
  }
  function warn(value: string) {
    panel.showNotice(value, 'warning');
  }
  function request(id: string): DispatchRequest {
    return { ...target, inputs: { ...inputs }, requestId: id };
  }

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
      dialogEpoch.invalidate();
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
    changeAccount(value.accounts.at(-1)?.id ?? '');
    openSettings();
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

  /** Dialog state only; running operations keep their own busy state. */
  function resetDialog() {
    dialogEpoch.invalidate();
    dialogError = '';
    dialogNotice = '';
    outcome = null;
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
  /** Shows an accepted start in the full activity list. */
  function showRun(id: number | null) {
    closeModal();
    if (panel.notice?.runId) panel.notice = null;
    tab = 'activity';
    filter = 'all';
    query = '';
    expanded = id;
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
  }
  function setInput(name: string, value: InputValue) {
    inputs = { ...inputs, [name]: value };
    dialogError = '';
  }

  async function startFromDialog() {
    if (starting || panel.templateBusy) return;
    const ticket = dialogEpoch.next();
    outcome = null;
    dialogError = '';
    dialogNotice = '';
    const result = await panel.starts.dispatch(request(crypto.randomUUID()), {
      // Closing, replacing or retargeting the dialog hands the result to the banner.
      owner: () => modal === 'dispatch' && dialogEpoch.current(ticket),
    });
    if (!result) return;
    if ('error' in result) dialogError = result.error;
    else outcome = result.outcome;
    await tick();
    const box = outcome ? outcomeBox : errorBox;
    box?.scrollIntoView({ block: 'nearest' });
    box?.focus({ preventScroll: true });
  }
  async function checkStartStatus() {
    const key = targetKey(target);
    const latest = await panel.refresh();
    if (modal !== 'dispatch' || targetKey(target) !== key) return;
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
  function launchPin(pin: Pin) {
    if (pin.quickStart)
      void panel.starts.dispatch(pinRequest(pin), { label: pin.label });
    else openDispatch(pin);
  }
  async function toggleFavorite(workflow: Workflow) {
    if ((await panel.toggleFavorite(workflow)) !== 'incomplete') return;
    openDispatch(undefined, workflow);
    favoriteIntent = true;
    dialogNotice =
      'Ergänze die benötigten Angaben und speichere die Action als Vorlage.';
  }
  async function saveTemplate(asNew = false) {
    if (!chosenRepo || panel.templateBusy || starting) return;
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
    dialogError = '';
    dialogNotice = '';
    try {
      if (!(await panel.saveTemplate(pin)) || !dialogEpoch.current(ticket))
        return;
      editingPinId = pin.id;
      dialogNoticeTone = 'subtle';
      dialogNotice = 'Vorlage lokal gespeichert.';
    } catch (cause) {
      if (dialogEpoch.current(ticket)) dialogError = errorMessage(cause);
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
          title={panel.error
            ? 'Demo nicht geladen'
            : 'Workflows werden sortiert …'}
          text={panel.error
            ? 'Starte die Anwendung neu, um den lokalen Demo-Stand zu laden.'
            : 'Dein Überblick ist gleich bereit.'}
        />
      {:else if tab === 'repositories'}
        <PinnedFavorites
          {pins}
          isUncertain={panel.starts.isQuarantined}
          {repoName}
          {accountName}
          dispatching={panel.starts.any}
          busy={panel.pinsBusy}
          {blocked}
          onConfigure={(pin) => openDispatch(pin)}
          onRemove={panel.deletePin}
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
          favorite={panel.favoritePin}
          busy={panel.pinsBusy}
          dispatching={panel.starts.any}
          {blocked}
        />
        {#if !repoGroups.length}<EmptyState
            icon="repo"
            iconSize={25}
            title={panel.needsAccount
              ? snapshot.accounts.length
                ? 'Wähle ein aktives Konto'
                : 'Verbinde dein GitHub-Konto'
              : query
                ? 'Keine passenden Repositories'
                : 'Noch keine Repositories ausgewählt'}
            text={panel.needsAccount
              ? panel.accountNotice ||
                'Wähle Konto und Repositories in den Einstellungen.'
              : query
                ? 'Suche nach einem Repository oder einer Action.'
                : 'Wähle Repositories in den Einstellungen aus.'}
            action={query
              ? { label: 'Suche leeren', icon: 'close', run: clearQuery }
              : {
                  label: panel.needsAccount
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
          needsAccount={panel.needsAccount}
          hasAccounts={!!snapshot.accounts.length}
          hasRepos={repos.length > 0}
          searching={!!query}
          accountNotice={panel.accountNotice}
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
          isUncertain={panel.starts.isQuarantined}
          {repoName}
          {accountName}
          {demo}
          dispatching={panel.starts.any}
          busy={panel.pinsBusy}
          {blocked}
          searching={!!query.trim()}
          hasRepos={repos.length > 0}
          needsAccount={panel.needsAccount}
          onLaunch={launchPin}
          onConfigure={(pin) => openDispatch(pin)}
          onRemove={panel.deletePin}
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
            disabled={starting}
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
            disabled={starting}
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
            disabled={starting}
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
                disabled={starting}
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
                  disabled={starting}
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
                  disabled={starting}
                />{:else}<input
                  type="text"
                  aria-label={input.label}
                  value={String(inputs[input.name] ?? '')}
                  oninput={(event) =>
                    setInput(input.name, event.currentTarget.value)}
                  autocomplete="off"
                  disabled={starting}
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
                      !starting &&
                      !panel.templateBusy
                    )
                      void saveTemplate();
                  }
                }}
                disabled={starting || panel.templateBusy}
                maxlength="80"
                placeholder="z. B. Windows build"
              /></label
            ><label class="quick-opt-in"
              ><input
                type="checkbox"
                bind:checked={pinQuickStart}
                disabled={starting || panel.templateBusy}
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
              onclick={() => void saveTemplate()}
              disabled={panel.templateBusy ||
                starting ||
                !!validation ||
                !pinLabel.trim()}
              ><Icon name="pin" size={13} />{panel.templateBusy
                ? 'Speichert …'
                : editingPinId
                  ? 'Vorlage aktualisieren'
                  : 'Vorlage speichern'}</button
            >
            {#if editingPinId}<button
                type="button"
                class="text-button copy-template"
                onclick={() => void saveTemplate(true)}
                disabled={panel.templateBusy ||
                  starting ||
                  !!validation ||
                  !pinLabel.trim()}
                >Als neue Vorlage speichern<Icon
                  name="plus"
                  size={13}
                /></button
              >{/if}
          </div>
        </details>
        {#if dialogError}<div
            class="alert danger"
            role="alert"
            tabindex="-1"
            bind:this={errorBox}
          >
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
                disabled={panel.refreshing}
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
            tabindex="-1"
            bind:this={outcomeBox}
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
                  onclick={() => showRun(outcome?.runId ?? null)}
                  >In Aktivität anzeigen<Icon name="arrow" size={13} /></button
                >
              {/if}
              {#if outcome.state === 'uncertain'}<button
                  type="button"
                  class="text-button"
                  onclick={checkStartStatus}
                  disabled={panel.refreshing}
                  >Status prüfen<Icon name="refresh" size={12} /></button
                >{/if}
            </div>
          </div>{/if}
      </div>
      {#if starting}<p
          class="dialog-alert alert subtle"
          id="start-continues"
          role="status"
        >
          <Icon name="refresh" size={14} /><span
            >Der Start läuft weiter, auch wenn du den Dialog schließt. Das
            Ergebnis erscheint dann im Panel.</span
          >
        </p>{/if}
      <div class="modal-actions">
        <button
          type="button"
          class="secondary-button"
          onclick={closeModal}
          aria-describedby={starting ? 'start-continues' : undefined}
          >{outcome || starting ? 'Schließen' : 'Abbrechen'}</button
        ><button
          type="button"
          class="primary-button"
          onclick={() => void startFromDialog()}
          disabled={starting ||
            targetUncertain ||
            panel.templateBusy ||
            !!validation ||
            blocked ||
            outcome?.state === 'uncertain' ||
            outcome?.state === 'accepted'}
          >{starting
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
