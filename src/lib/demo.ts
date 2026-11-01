import fixture from '../../fixtures/demo.json';
import { safePin, validateDispatch } from './model';
import type {
  DemoScenario,
  DispatchOutcome,
  DispatchRequest,
  DispatchTarget,
  Pin,
  Snapshot,
  UncertainStart,
} from './types';

export interface Bridge {
  snapshot(): Promise<Snapshot>;
  refreshSnapshot(): Promise<Snapshot>;
  selectRepos(repoIds: string[]): Promise<Snapshot>;
  savePin(pin: Pin): Promise<Snapshot>;
  deletePin(pinId: string): Promise<Snapshot>;
  dispatchWorkflow(request: DispatchRequest): Promise<DispatchOutcome>;
  /** Explicit user action after checking GitHub; releases exactly this claim, never dispatches. */
  releaseUncertainStart(start: UncertainStart): Promise<Snapshot>;
  setDemoScenario(scenario: DemoScenario): Promise<Snapshot>;
  resetDemo(): Promise<Snapshot>;
}
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export const PREFERENCE_KEY = 'repotray.demo.preferences.v1';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const targetKey = (target: DispatchTarget) =>
  JSON.stringify([
    target.accountId,
    target.repoId,
    target.workflowId,
    target.ref,
  ]);
const fingerprint = (request: DispatchRequest) =>
  JSON.stringify([
    targetKey(request),
    Object.entries(request.inputs).sort(([a], [b]) => a.localeCompare(b)),
  ]);

export function createDemoBridge(
  storage?: PreferenceStorage,
  latency = 300,
): Bridge {
  let data = copy(fixture) as Snapshot;
  let scenario: DemoScenario = 'normal';
  let nextRun = 9000;
  let generation = 0;
  const pending = new Set<string>();
  const uncertain = new Map<string, UncertainStart>();
  const claims = new Map<string, string>();
  const outcomes = new Map<string, DispatchOutcome>();
  const simulated = new Map<number, number>();
  const delay = () =>
    new Promise<void>((resolve) => setTimeout(resolve, latency));
  try {
    const stored = JSON.parse(storage?.getItem(PREFERENCE_KEY) ?? 'null');
    if (stored && Array.isArray(stored.repoIds))
      data.repos.forEach((r) => {
        r.selected = stored.repoIds.includes(r.id);
      });
    if (stored && Array.isArray(stored.pins)) {
      data.pins = stored.pins.flatMap((pin: Pin) => {
        try {
          // A saved pin may belong to a temporarily deselected repository.
          const validation = copy(data);
          validation.repos.forEach((r) => {
            r.selected = true;
          });
          return [safePin(validation, pin)];
        } catch {
          return [];
        }
      });
    }
  } catch {
    /* Corrupt or unavailable preferences never prevent startup. */
  }
  const persist = () => {
    try {
      storage?.setItem(
        PREFERENCE_KEY,
        JSON.stringify({
          repoIds: data.repos.filter((r) => r.selected).map((r) => r.id),
          pins: data.pins,
        }),
      );
    } catch {
      /* An in-memory demo remains usable with storage disabled. */
    }
  };
  const snapshot = (): Snapshot => {
    if (scenario !== 'offline') {
      for (const run of data.runs) {
        const started = simulated.get(run.id);
        if (started === undefined) continue;
        const elapsed = Date.now() - started;
        const status =
          elapsed >= 2000
            ? 'completed'
            : elapsed >= 1000
              ? 'in_progress'
              : 'queued';
        if (run.status !== status) {
          run.status = status;
          run.conclusion = status === 'completed' ? 'success' : null;
          run.updatedAt = new Date().toISOString();
          data.updatedAt = run.updatedAt;
        }
        if (status === 'completed') simulated.delete(run.id);
      }
    }
    return copy({
      ...data,
      connectivity:
        scenario === 'offline'
          ? 'offline'
          : scenario === 'forbidden'
            ? 'forbidden'
            : 'online',
      stale: scenario === 'offline',
      uncertainStarts: [...uncertain.values()],
      message:
        scenario === 'offline'
          ? 'Offline: Letzter Demo-Stand bleibt sichtbar. Es wurde nichts gestartet.'
          : scenario === 'forbidden'
            ? 'Zugriff verweigert: Demo simuliert fehlende Berechtigungen.'
            : undefined,
    });
  };
  const reject = (message: string): DispatchOutcome => ({
    state: 'rejected',
    message,
  });
  return {
    async snapshot() {
      return snapshot();
    },
    async refreshSnapshot() {
      await delay();
      if (scenario !== 'offline') data.updatedAt = new Date().toISOString();
      return snapshot();
    },
    async selectRepos(repoIds) {
      if (repoIds.some((id) => !data.repos.some((r) => r.id === id)))
        throw new Error('Unbekanntes Repository.');
      data.repos.forEach((r) => {
        r.selected = repoIds.includes(r.id);
      });
      persist();
      return snapshot();
    },
    async savePin(pin) {
      const safe = safePin(data, copy(pin));
      data.pins = [...data.pins.filter((p) => p.id !== safe.id), safe];
      persist();
      return snapshot();
    },
    async deletePin(pinId) {
      data.pins = data.pins.filter((p) => p.id !== pinId);
      persist();
      return snapshot();
    },
    async dispatchWorkflow(input) {
      const request = copy(input);
      const key = targetKey(request);
      const signature = fingerprint(request);
      const claim = claims.get(request.requestId);
      if (claim && claim !== signature)
        return reject(
          'Diese Anfrage-ID wurde bereits mit anderen Eingaben verwendet.',
        );
      const previous = outcomes.get(request.requestId);
      if (previous) return copy(previous);
      const validation = validateDispatch(data, request);
      if (validation) return reject(validation);
      if (uncertain.has(key))
        return {
          state: 'uncertain',
          message:
            'Demo: Der letzte Start für diesen Workflow und Branch ist unbestätigt und wurde nicht erneut gesendet. Setze die Demo zurück, um erneut zu testen.',
        };
      if (pending.has(key))
        return reject(
          'Ein Start für diesen Workflow und Branch wird bereits verarbeitet.',
        );
      claims.set(request.requestId, signature);
      pending.add(key);
      const ticket = generation;
      try {
        await delay();
        if (ticket !== generation)
          return reject('Die Demo wurde zurückgesetzt.');
        const changed = validateDispatch(data, request);
        if (changed) return reject(changed);
        if (scenario === 'offline')
          return reject('Offline: Kein simulierter Start möglich.');
        if (scenario === 'forbidden')
          return reject(
            'Zugriff verweigert: Die Token-Berechtigung „Actions: Lesen und Schreiben“ fehlt.',
          );
        if (scenario === 'uncertain') {
          const { accountId, repoId, workflowId, ref } = request;
          uncertain.set(key, {
            accountId,
            repoId,
            workflowId,
            ref,
            claimedAt: new Date().toISOString(),
          });
          const outcome: DispatchOutcome = {
            state: 'uncertain',
            message:
              'Demo: Antwort unterbrochen. Der Start ist unbestätigt und läuft eventuell bereits. Ein erneuter Start für diesen Workflow und Branch bleibt gesperrt.',
          };
          outcomes.set(request.requestId, outcome);
          return copy(outcome);
        }
        const workflow = data.workflows.find(
          (w) => w.id === request.workflowId && w.repoId === request.repoId,
        )!;
        const runId = ++nextRun;
        const now = new Date().toISOString();
        data.runs.unshift({
          id: runId,
          repoId: request.repoId,
          workflowId: request.workflowId,
          name: workflow.name,
          branch: request.ref,
          status: 'queued',
          conclusion: null,
          createdAt: now,
          updatedAt: now,
          htmlUrl: '',
        });
        simulated.set(runId, Date.now());
        data.updatedAt = now;
        const outcome: DispatchOutcome = {
          state: 'accepted',
          runId,
          message: `Simulierter Start angenommen · Demo-Run #${runId}. Dies ist keine Build-Erfolgsmeldung.`,
        };
        outcomes.set(request.requestId, outcome);
        return copy(outcome);
      } finally {
        if (ticket === generation) pending.delete(key);
      }
    },
    async releaseUncertainStart(start) {
      const key = targetKey(start);
      const current = uncertain.get(key);
      if (current && current.claimedAt !== start.claimedAt)
        throw new Error(
          'Für diesen Workflow auf diesem Branch oder Tag gibt es eine neuere Startsperre. Prüfe die Runs erneut.',
        );
      uncertain.delete(key);
      return snapshot();
    },
    async setDemoScenario(next) {
      scenario = next;
      return snapshot();
    },
    async resetDemo() {
      generation++;
      data = copy(fixture) as Snapshot;
      scenario = 'normal';
      nextRun = 9000;
      pending.clear();
      uncertain.clear();
      outcomes.clear();
      claims.clear();
      simulated.clear();
      try {
        storage?.removeItem(PREFERENCE_KEY);
      } catch {
        /* Storage may be unavailable. */
      }
      return snapshot();
    },
  };
}
