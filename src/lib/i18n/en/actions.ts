import type { actions as German } from '../de/actions';

/** English texts: run and repository actions. Same shape as the German catalog. */
export const actions: typeof German = {
  cancelRequested: (runId: number) => `Cancellation of #${runId} requested.`,
  repoShown: (name: string) => `${name} shown`,
  repoHidden: (name: string) => `${name} hidden`,
};
