import type { dispatch as German } from '../de/dispatch';

/** English texts: dispatch. Same shape as the German catalog. */
export const dispatch: typeof German = {
  reasons: {
    manual: 'No manual start',
    readOnly: 'No write access to this repository',
    offline: 'Offline – starts are disabled',
    forbidden: 'Access denied – starts are disabled',
    running: 'Starting…',
    uncertain: 'Start status uncertain – check the runs on GitHub',
  },
  dialog: {
    title: 'Start workflow',
    demoNote: 'Local simulation · no real workflow start',
    liveNote: 'Real GitHub workflow start · check account and target',
    completeFavorite:
      'Fill in the required fields and save the workflow as a favorite.',
    alreadyStarted: 'Already started – reopen the dialog to start again',
    savingFavorite: 'Saving favorite…',
    chooseTarget: 'Choose a repository and workflow.',
    offline: 'Offline. Starts are disabled; the last state stays visible.',
    forbidden:
      'Access denied. Check the token permission “Actions: Read and write”. Starts are disabled.',
  },
  actions: {
    continues:
      'The start continues if you close the dialog. The result then appears in the panel.',
    simulating: 'Simulating…',
    starting: 'Starting…',
    simulate: 'Simulate start',
    start: 'Start workflow',
  },
  target: {
    repository: 'Repository',
    noRepositories: 'No repositories',
    workflow: 'Workflow',
    noWorkflow: 'No workflow available',
    noManualStart: ' · no manual start',
    ref: 'Branch or tag',
    defaultBranch: ' · default branch',
  },
  inputs: {
    heading: 'INPUTS',
    count: (count: number) => (count === 1 ? '1 input' : `${count} inputs`),
    types: {
      string: 'Text',
      number: 'Number',
      choice: 'Choice',
      environment: 'Environment',
      boolean: 'Yes/No',
    },
    unset: 'Not set',
  },
  outcome: {
    accepted: 'GitHub accepted the start',
    acceptedDemo: 'Simulated start accepted',
    rejected: 'Start rejected',
    viewRun: (runId: number) => `View run #${runId} on GitHub`,
    showInHistory: 'Show in history',
    rejectedNotice: (name: string, message: string) =>
      `${name}: Start rejected. ${message}`,
  },
  uncertain: {
    title: 'Start status uncertain',
    locked:
      'GitHub did not confirm the last start for this workflow and branch. It may already be running. Check the runs on GitHub. Starting again stays locked until you unlock it.',
    checkStatus: 'Check status',
    checkFailed:
      'Could not check the status. Check your connection and try again. Starts stay locked.',
    stillUnconfirmed:
      'Status checked. GitHub still has not confirmed the start. Starting again stays locked.',
    released: 'Unlocked. You can start the workflow again.',
    release: {
      ask: 'Unlock…',
      title: 'Unlock?',
      text: 'Only unlock once you have checked on GitHub that this start is not running or that starting again is intended. RepoWatch starts nothing when you unlock.',
      confirm: 'I checked the runs on GitHub – unlock',
      busy: 'Unlocking…',
    },
    help: {
      text: 'GitHub did not confirm the start. The workflow may already be running. Starting this workflow and branch again stays locked.',
      next: 'Choose the favorite, then “Check status”, or after checking GitHub, “Unlock…”.',
      demo: 'Clear the sample lock in the start dialog or with “Reset demo”.',
      live: 'The start lock stays after a restart until you unlock it.',
    },
  },
};
