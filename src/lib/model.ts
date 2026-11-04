// Dispatch targets, workflow inputs and favorites, and their validation.
import { m } from './i18n/index.svelte';
import type {
  DispatchRequest,
  DispatchTarget,
  InputValue,
  Pin,
  Repo,
  Snapshot,
  Workflow,
} from './types';

export const fullRepo = (repo: Repo) => `${repo.owner}/${repo.name}`;

/** Identity of a dispatch target; inputs and request ID are deliberately not part of it. */
export function targetKey(value: DispatchTarget): string {
  return JSON.stringify([
    value.accountId,
    value.repoId,
    value.workflowId,
    value.ref,
  ]);
}

export const isSecretName = (name: string) =>
  /(?:token|secret|password|credential|private[_-]?key|api[_-]?key)/i.test(
    name,
  );

export function defaultInputs(workflow: Workflow): Record<string, InputValue> {
  return Object.fromEntries(
    workflow.inputs.map((input) => [
      input.name,
      input.default ?? (input.type === 'boolean' ? false : ''),
    ]),
  );
}

export function validateDispatch(
  snapshot: Snapshot,
  request: DispatchRequest,
): string | null {
  const text = m().common.validation;
  const repo = snapshot.repos.find((item) => item.id === request.repoId);
  if (
    !snapshot.accounts.some((account) => account.id === request.accountId) ||
    !repo ||
    repo.accountId !== request.accountId
  )
    return text.accountMismatch;
  if (!repo.selected) return text.repoNotInTray;
  if (repo.permission !== 'write') return text.noWriteAccess;
  const workflow = snapshot.workflows.find(
    (item) => item.id === request.workflowId && item.repoId === repo.id,
  );
  if (!workflow || !workflow.dispatch) return text.noDispatch;
  if (!workflow.refs.includes(repo.defaultBranch))
    return text.noDefaultBranchDispatch;
  if (!workflow.refs.includes(request.ref)) return text.refUnavailable;
  if (!request.requestId.trim()) return text.requestId;
  if (
    Object.keys(request.inputs).some(
      (name) => !workflow.inputs.some((input) => input.name === name),
    )
  )
    return text.unknownInput;
  for (const input of workflow.inputs) {
    const value = request.inputs[input.name];
    const absent =
      value === undefined || (typeof value === 'string' && !value.trim());
    if (absent && input.required) return text.required(input.label);
    if (absent) continue;
    if (input.type === 'boolean' && typeof value !== 'boolean')
      return text.boolean(input.label);
    if (
      input.type === 'number' &&
      (typeof value !== 'number' || !Number.isFinite(value))
    )
      return text.number(input.label);
    if (
      ['string', 'choice', 'environment'].includes(input.type) &&
      typeof value !== 'string'
    )
      return text.text(input.label);
    if (
      ['choice', 'environment'].includes(input.type) &&
      !input.options.includes(String(value))
    )
      return text.option(input.label);
  }
  return null;
}

export function safePin(snapshot: Snapshot, pin: Pin): Pin {
  const error = validateDispatch(snapshot, {
    ...pin,
    requestId: 'pin-validation',
  });
  if (error) throw new Error(error);
  const text = m().common.validation;
  if (!pin.label.trim() || !pin.id.trim()) throw new Error(text.favoriteName);
  if (Object.keys(pin.inputs).some(isSecretName))
    throw new Error(text.secretInputs);
  return {
    id: pin.id,
    label: pin.label.trim(),
    accountId: pin.accountId,
    repoId: pin.repoId,
    workflowId: pin.workflowId,
    ref: pin.ref,
    inputs: { ...pin.inputs },
    quickStart: pin.quickStart === true,
  };
}

/** Invalidate responses when their UI context has changed or a dialog has closed. */
export class RequestEpoch {
  private value = 0;
  next() {
    return ++this.value;
  }
  current(ticket: number) {
    return ticket === this.value;
  }
  invalidate() {
    this.value++;
  }
}
