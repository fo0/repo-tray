<script module lang="ts">
  import type { Pin, Workflow } from './types';

  /** What the start dialog opens with. */
  export interface DispatchSeed {
    pin?: Pin;
    workflow?: Workflow;
    /** Opened from a heart favorite that still needs input. */
    favoriteIntent?: boolean;
  }
</script>

<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import DispatchActions from './DispatchActions.svelte';
  import DispatchOutcome from './DispatchOutcome.svelte';
  import DispatchTargetFields from './DispatchTargetFields.svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';
  import SavePinPanel from './SavePinPanel.svelte';
  import WorkflowInputs from './WorkflowInputs.svelte';
  import { accountLabel, errorMessage } from './format';
  import {
    defaultInputs,
    RequestEpoch,
    targetKey,
    validateDispatch,
  } from './model';
  import type { Panel } from './panel.svelte';
  import type {
    DispatchOutcome as Outcome,
    DispatchRequest,
    DispatchTarget,
    InputValue,
  } from './types';

  let {
    panel,
    seed,
    returnFocus,
    onClose,
    onShowRun,
    onLinkError,
  }: {
    panel: Panel;
    seed: DispatchSeed;
    returnFocus?: () => HTMLElement | null | undefined;
    onClose: () => void;
    onShowRun: (runId: number) => void;
    onLinkError: (message: string) => void;
  } = $props();

  const snapshot = $derived(panel.snapshot);
  const demo = $derived(panel.demo);
  let repoId = $state('');
  let workflowId = $state(0);
  let ref = $state('main');
  let inputs = $state<Record<string, InputValue>>({});
  let pinLabel = $state('');
  let pinQuickStart = $state(false);
  let editingPinId = $state<string | null>(null);
  let outcome = $state<Outcome | null>(null);
  let error = $state('');
  let notice = $state('');
  let noticeTone = $state<'subtle' | 'warning'>('subtle');
  let result = $state<ReturnType<typeof DispatchOutcome>>();
  /** Bumped whenever the target changes; a stale ticket hands results to the banner. */
  const epoch = new RequestEpoch();
  let alive = true;
  onDestroy(() => {
    alive = false;
    epoch.invalidate();
  });

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
  const uncertain = $derived(panel.starts.isQuarantined(target));
  /** A start for this target is running, from this dialog or a quick start. */
  const starting = $derived(panel.starts.isRunning(target));

  function request(id: string): DispatchRequest {
    return { ...target, inputs: { ...inputs }, requestId: id };
  }
  function clearMessages() {
    outcome = null;
    error = '';
    notice = '';
  }
  function selectWorkflow(value: number) {
    epoch.invalidate();
    clearMessages();
    workflowId = value;
    editingPinId = null;
    const workflow = workflows.find((item) => item.id === value);
    inputs = workflow ? defaultInputs(workflow) : {};
    ref = chosenRepo?.defaultBranch ?? 'main';
    if (workflow && !workflow.refs.includes(ref)) ref = workflow.refs[0] ?? '';
    pinLabel = workflow?.name ?? '';
    pinQuickStart = false;
  }
  function selectRepo(value: string) {
    repoId = value;
    // `workflows` already follows the new repository.
    const first = workflows.find((item) => item.dispatch) ?? workflows[0];
    selectWorkflow(first?.id ?? 0);
  }
  function changeRef(value: string) {
    epoch.invalidate();
    clearMessages();
    ref = value;
  }
  function setInput(name: string, value: InputValue) {
    inputs = { ...inputs, [name]: value };
    error = '';
  }

  untrack(() => {
    const { pin, workflow } = seed;
    const repos = panel.repos;
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
    if (seed.favoriteIntent)
      notice =
        'Ergänze die benötigten Angaben und speichere den Workflow als Favorit.';
  });

  async function start() {
    if (starting || panel.templateBusy) return;
    const ticket = epoch.next();
    clearMessages();
    const answer = await panel.starts.dispatch(request(crypto.randomUUID()), {
      // Closing, replacing or retargeting the dialog hands the result to the banner.
      owner: () => alive && epoch.current(ticket),
    });
    if (!answer) return;
    if ('error' in answer) error = answer.error;
    else outcome = answer.outcome;
    await tick();
    result?.focus();
  }
  async function checkStatus() {
    const key = targetKey(target);
    const latest = await panel.refresh();
    if (!alive || targetKey(target) !== key) return;
    if (!latest || latest.stale || latest.connectivity !== 'online') {
      notice = '';
      error =
        'Status konnte nicht geprüft werden. Prüfe deine Verbindung und versuche es erneut. Starts bleiben gesperrt.';
    } else {
      error = '';
      noticeTone = 'warning';
      notice =
        'Status geprüft. GitHub hat den Start weiterhin nicht bestätigt. Ein erneuter Start bleibt gesperrt.';
    }
  }
  async function saveTemplate(asNew: boolean) {
    if (!chosenRepo || panel.templateBusy || starting) return;
    const pin: Pin = {
      id: !asNew && editingPinId ? editingPinId : crypto.randomUUID(),
      label: pinLabel,
      ...target,
      inputs: { ...inputs },
      quickStart: pinQuickStart,
    };
    const ticket = epoch.next();
    error = '';
    notice = '';
    try {
      if (!(await panel.saveTemplate(pin)) || !alive || !epoch.current(ticket))
        return;
      editingPinId = pin.id;
      noticeTone = 'subtle';
      notice = `„${pin.label.trim()}“ als Favorit gespeichert.`;
    } catch (cause) {
      if (alive && epoch.current(ticket)) error = errorMessage(cause);
    }
  }
</script>

<Modal
  title="Workflow starten"
  eyebrow={`REPOTRAY · ${demo ? 'DEMO' : 'GITHUB'}`}
  {returnFocus}
  {onClose}
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
      <DispatchTargetFields
        repos={panel.repos}
        {workflows}
        {repoId}
        {workflowId}
        gitRef={ref}
        defaultBranch={chosenRepo?.defaultBranch}
        disabled={starting}
        accountName={(id) => accountLabel(snapshot, id, panel.native)}
        onRepo={selectRepo}
        onWorkflow={selectWorkflow}
        onRef={changeRef}
      />
      <WorkflowInputs
        workflow={chosenWorkflow}
        values={inputs}
        disabled={starting}
        onChange={setInput}
      />
      {#if validation}<div class="alert warning">
          <Icon name="shield" size={16} /><span>{validation}</span>
        </div>{/if}
      {#if panel.blocked}<div class="alert warning">
          <Icon name="warning" size={16} /><span
            >{snapshot?.connectivity === 'offline'
              ? 'Offline. Starts sind deaktiviert; der letzte Stand bleibt sichtbar.'
              : 'Zugriff verweigert. Prüfe die Token-Berechtigung „Actions: Lesen und Schreiben“. Starts sind deaktiviert.'}</span
          >
        </div>{/if}
      <SavePinPanel
        open={!!seed.favoriteIntent}
        bind:label={pinLabel}
        bind:quickStart={pinQuickStart}
        editing={!!editingPinId}
        saving={panel.templateBusy}
        locked={starting}
        valid={!validation}
        onSave={(asNew) => void saveTemplate(asNew)}
      />
      <DispatchOutcome
        bind:this={result}
        {outcome}
        {error}
        {notice}
        {noticeTone}
        {uncertain}
        {demo}
        native={panel.native}
        checking={panel.refreshing}
        onCheckStatus={checkStatus}
        {onShowRun}
        {onLinkError}
      />
    </div>
    <DispatchActions
      {demo}
      {starting}
      finished={!!outcome}
      canStart={!uncertain &&
        !panel.templateBusy &&
        !validation &&
        !panel.blocked &&
        outcome?.state !== 'uncertain' &&
        outcome?.state !== 'accepted'}
      {onClose}
      onStart={() => void start()}
    />
  </form>
</Modal>
