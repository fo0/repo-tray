import { defaultInputs } from './model';
import type { DispatchRequest, Pin, Snapshot, Workflow } from './types';

/** The heart favorite of a workflow: its default inputs on the default branch. */
export function findFavorite(
  snapshot: Snapshot | null,
  workflow: Workflow,
): Pin | undefined {
  const repo = snapshot?.repos.find((item) => item.id === workflow.repoId);
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

/** A new heart favorite; null when the workflow's repository is unknown. */
export function favoriteDraft(
  snapshot: Snapshot,
  workflow: Workflow,
): Pin | null {
  const repo = snapshot.repos.find((item) => item.id === workflow.repoId);
  if (!repo) return null;
  return {
    id: crypto.randomUUID(),
    label: workflow.name,
    accountId: repo.accountId,
    repoId: repo.id,
    workflowId: workflow.id,
    ref: repo.defaultBranch,
    inputs: defaultInputs(workflow),
    quickStart: false,
  };
}

/** What a quick start sends for a template: its stored target and inputs, a fresh ID. */
export function pinRequest(pin: Pin): DispatchRequest {
  return {
    accountId: pin.accountId,
    repoId: pin.repoId,
    workflowId: pin.workflowId,
    ref: pin.ref,
    inputs: { ...pin.inputs },
    requestId: crypto.randomUUID(),
  };
}
