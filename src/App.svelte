<script lang="ts">
  import { onMount, tick } from 'svelte';
  import AppBar from './lib/AppBar.svelte';
  import AppFooter from './lib/AppFooter.svelte';
  import ConnectPanel from './lib/ConnectPanel.svelte';
  import DispatchDialog from './lib/DispatchDialog.svelte';
  import Modal from './lib/Modal.svelte';
  import NativeConnect from './lib/NativeConnect.svelte';
  import PanelBody from './lib/PanelBody.svelte';
  import SearchField from './lib/SearchField.svelte';
  import SettingsDialog from './lib/SettingsDialog.svelte';
  import StatusBanners from './lib/StatusBanners.svelte';
  import appPackage from '../package.json';
  import { bridge, native, observeSnapshots } from './lib/bridge';
  import { accountLabel, repoLabel } from './lib/format';
  import { Modals } from './lib/modals.svelte';
  import { Panel } from './lib/panel.svelte';
  import { createShortcuts } from './lib/shortcuts';
  import type { Snapshot } from './lib/types';
  import { Updater } from './lib/updater.svelte';
  import { PanelView } from './lib/view.svelte';

  const appVersion = appPackage.version;
  const panel = new Panel({ bridge, native, observe: observeSnapshots });
  const updater = new Updater(native);
  const snapshot = $derived(panel.snapshot);
  const demo = $derived(panel.demo);
  const accountId = $derived(panel.accountId);

  let demoAccountConnected = $state(false);
  let searchField = $state<ReturnType<typeof SearchField>>();
  let appBar = $state<ReturnType<typeof AppBar>>();
  const view = new PanelView(panel);
  const modals = new Modals(panel, view.showRun);
  const { openSettings } = modals;

  const repoName = (id: string) => repoLabel(snapshot, id);
  const accountName = (id: string) => accountLabel(snapshot, id, native);
  const repoAccountName = (id: string) =>
    accountName(
      snapshot?.repos.find((repo) => repo.id === id)?.accountId ?? '',
    );
  /** Empty-state „Suche leeren“: its button goes, focus moves to the field. */
  const clearQuery = () => {
    view.query = '';
    searchField?.focus();
  };
  const warn = (value: string) => panel.showNotice(value, 'warning');

  /** A load error offers a retry before any snapshot exists. */
  const canRefresh = $derived(!!snapshot || !!panel.error);

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

  /** A refresh that recovers from a load error also runs the skipped startup update check. */
  async function refreshPanel() {
    const recovering = !panel.snapshot;
    const next = await panel.refresh();
    if (native && recovering && next) void updater.check(true);
  }
  function changeAccount(value: string) {
    panel.changeAccount(value);
    view.reset();
    if (modals.kind === 'dispatch') modals.close();
  }
  function connectedNative(value: Snapshot) {
    panel.viewEpoch.invalidate();
    panel.accept(value);
    // An explicit connection selects that entry; the service lists it last.
    const account = value.accounts.at(-1);
    changeAccount(account?.id ?? '');
    // A new account starts without selected repositories: the picker is the
    // next step. Its page is set before the dialog closes, so the dialog's
    // focus return lands in it instead of on a vanished opener.
    if (account && !panel.repos.length) {
      void view.open('picker', { connected: account.login, opener: null });
      modals.close();
    } else openSettings();
    void updater.check(true);
  }
  function connectedDemo(method: 'browser' | 'token') {
    demoAccountConnected = true;
    modals.close();
    panel.showNotice(
      method === 'token'
        ? 'Demo-Token geprüft und verworfen · demo-dev ist nur simuliert verbunden.'
        : 'Demo-Anmeldung bestätigt · demo-dev ist nur simuliert verbunden.',
    );
    void tick().then(() => appBar?.focusAccount());
  }

  /** Empty-state actions open the missing step: connect, account or repositories. */
  function openNextStep() {
    if (native && !snapshot?.accounts.length) modals.show('connect');
    else if (panel.needsAccount) appBar?.openAccountMenu();
    else void view.open('picker', { from: view.page });
  }
  const shortcuts = createShortcuts({
    blocked: () => modals.kind !== null,
    refresh: () => void (canRefresh && refreshPanel()),
    toggleSection: view.toggle,
    focusSearch: () => searchField?.focus(),
    // Search first, then the open page; menus handle their own Escape.
    escape: (target) => !!searchField?.escape(target) || view.back(),
  });
</script>

<svelte:window onkeydown={shortcuts} />

<!-- `inert` already hides the page from assistive tech while a dialog is
     open; aria-hidden states it for tools that do not model `inert`. -->
<main
  class="desktop"
  inert={modals.kind !== null}
  aria-hidden={modals.kind !== null ? 'true' : undefined}
>
  <section class="tray" aria-label="RepoTray" data-page={view.page}>
    <AppBar
      bind:this={appBar}
      {native}
      {demo}
      accounts={snapshot?.accounts ?? []}
      {accountId}
      {accountName}
      connectivity={snapshot?.connectivity}
      refreshing={panel.refreshing}
      ready={!!snapshot}
      {canRefresh}
      busy={panel.settingsBusy}
      onAccountChange={changeAccount}
      onConnect={() => modals.show('connect')}
      onManageAccounts={() => openSettings('accounts')}
      onRefresh={() => void refreshPanel()}
      onSettings={() => openSettings()}
    />

    <PanelBody
      {panel}
      {modals}
      {view}
      {repoName}
      {accountName}
      {repoAccountName}
      onClearQuery={clearQuery}
      onNextStep={openNextStep}
    >
      {#snippet top()}
        <SearchField
          bind:this={searchField}
          page={view.page}
          bind:query={view.query}
        />
        <StatusBanners
          update={updater.info}
          {demo}
          {snapshot}
          error={panel.error}
          notices={panel.notices.items}
          showsAccount={panel.showsAccount}
          paused={modals.kind !== null}
          onShowUpdate={() => openSettings('updates')}
          onShowRun={modals.showRun}
          onDismissNotice={(id) => panel.notices.dismiss(id)}
        />
      {/snippet}
    </PanelBody>

    <AppFooter
      stale={!!snapshot?.stale}
      {demo}
      connectivity={snapshot?.connectivity}
      accountCount={snapshot?.accounts.length ?? 0}
      {demoAccountConnected}
      updatedAt={snapshot?.updatedAt}
      refreshing={panel.refreshing}
      {canRefresh}
      onRefresh={() => void refreshPanel()}
    />
  </section>
</main>

{#if modals.kind === 'settings'}
  <SettingsDialog
    {snapshot}
    {native}
    {demo}
    {accountId}
    accountNotice={panel.accountNotice}
    scenario={panel.scenario}
    {updater}
    {appVersion}
    initialTab={modals.settingsTab}
    busy={panel.settingsBusy}
    returnFocus={modals.returnFocus}
    onClose={modals.close}
    onConnect={() => modals.show('connect')}
    onChangeAccount={changeAccount}
    onScenario={panel.changeScenario}
    onReset={panel.resetDemo}
    onDisconnect={panel.disconnectAccount}
  />
{:else if modals.kind === 'connect'}
  <Modal
    title="GitHub verbinden"
    eyebrow={`REPOTRAY · ${demo ? 'DEMO' : 'GITHUB'}`}
    returnFocus={modals.returnFocus}
    onClose={modals.close}
  >
    {#if native}<NativeConnect
        accounts={snapshot?.accounts ?? []}
        activeAccountId={accountId}
        onSelectAccount={changeAccount}
        onConnected={connectedNative}
        onClose={modals.close}
      />{:else}<ConnectPanel
        onConnected={connectedDemo}
        onClose={modals.close}
        onSettings={() => openSettings()}
      />{/if}
  </Modal>
{:else if modals.kind === 'dispatch'}
  <DispatchDialog
    {panel}
    seed={modals.dispatchSeed}
    returnFocus={modals.returnFocus}
    onClose={modals.close}
    onShowRun={modals.showRun}
    onLinkError={warn}
  />
{/if}
