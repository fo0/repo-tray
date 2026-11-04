import type { demo as German } from '../de/demo';

/** English texts: demo. Same shape as the German catalog. */
export const demo: typeof German = {
  offline: 'Offline: the last demo state stays visible. Nothing was started.',
  forbidden: 'Access denied: the demo simulates missing permissions.',
  requestReused: 'This request ID was already used with different inputs.',
  stillUncertain:
    'Demo: the last start for this workflow and branch is unconfirmed and was not sent again. Reset the demo to test again.',
  pending: 'A start for this workflow and branch is already being processed.',
  wasReset: 'The demo was reset.',
  offlineStart: 'Offline: no simulated start possible.',
  forbiddenStart:
    'Access denied: the token permission “Actions: Read and write” is missing.',
  uncertain:
    'Demo: response interrupted. The start is unconfirmed and may already be running. Another start for this workflow and branch stays locked.',
  accepted: (runId: number) =>
    `Simulated start accepted · demo run #${runId}. This does not mean the build succeeded.`,
  runNotFound: 'Run not found.',
  runFinished: 'Run has already finished.',
  noWriteAccess: 'Write access to this repository is missing.',
  offlineCancel: 'Offline: no simulated cancel possible.',
  forbiddenCancel:
    'Cancel not allowed – the access needs “Actions: Read and write”.',
  repoNotFound: 'Repository not found.',
  newerLock:
    'There is a newer start lock for this workflow on this branch or tag. Check the runs again.',
};
