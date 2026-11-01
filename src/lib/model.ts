// Dispatch targets, workflow inputs and favorites, and their validation.
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
  const repo = snapshot.repos.find((item) => item.id === request.repoId);
  if (
    !snapshot.accounts.some((account) => account.id === request.accountId) ||
    !repo ||
    repo.accountId !== request.accountId
  )
    return 'Konto und Repository passen nicht zusammen.';
  if (!repo.selected)
    return 'Wähle dieses Repository zuerst in den Einstellungen aus.';
  if (repo.permission !== 'write')
    return 'Für dieses Repository fehlt der Schreibzugriff.';
  const workflow = snapshot.workflows.find(
    (item) => item.id === request.workflowId && item.repoId === repo.id,
  );
  if (!workflow || !workflow.dispatch)
    return 'Dieser Workflow bietet keinen manuellen Start auf dem Standardbranch an.';
  if (!workflow.refs.includes(repo.defaultBranch))
    return 'Auf dem Standardbranch ist kein manueller Start verfügbar.';
  if (!workflow.refs.includes(request.ref))
    return 'Dieser Branch oder Tag ist nicht verfügbar.';
  if (!request.requestId.trim())
    return 'Die Anfrage benötigt eine eindeutige ID.';
  if (
    Object.keys(request.inputs).some(
      (name) => !workflow.inputs.some((input) => input.name === name),
    )
  )
    return 'Unbekannte Workflow-Eingabe.';
  for (const input of workflow.inputs) {
    const value = request.inputs[input.name];
    const absent =
      value === undefined || (typeof value === 'string' && !value.trim());
    if (absent && input.required) return `${input.label} ist erforderlich.`;
    if (absent) continue;
    if (input.type === 'boolean' && typeof value !== 'boolean')
      return `${input.label} muss Ja oder Nein sein.`;
    if (
      input.type === 'number' &&
      (typeof value !== 'number' || !Number.isFinite(value))
    )
      return `${input.label} muss eine Zahl sein.`;
    if (
      ['string', 'choice', 'environment'].includes(input.type) &&
      typeof value !== 'string'
    )
      return `${input.label} muss Text sein.`;
    if (
      ['choice', 'environment'].includes(input.type) &&
      !input.options.includes(String(value))
    )
      return `${input.label}: Wähle einen verfügbaren Wert.`;
  }
  return null;
}

export function safePin(snapshot: Snapshot, pin: Pin): Pin {
  const error = validateDispatch(snapshot, {
    ...pin,
    requestId: 'pin-validation',
  });
  if (error) throw new Error(error);
  if (!pin.label.trim() || !pin.id.trim())
    throw new Error('Gib dem Favoriten einen Namen.');
  if (Object.keys(pin.inputs).some(isSecretName))
    throw new Error('Geheime Eingaben werden nicht in Favoriten gespeichert.');
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
