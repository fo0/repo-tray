/** German texts: run and repository actions. Every key needs its English twin in ../en/actions.ts. */
export const actions = {
  cancelRequested: (runId: number) => `Abbruch von #${runId} angefordert.`,
  repoShown: (name: string) => `${name} eingeblendet`,
  repoHidden: (name: string) => `${name} ausgeblendet`,
};
