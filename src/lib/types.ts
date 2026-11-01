export type InputValue = string | number | boolean;
export interface Account {
  id: string;
  login: string;
  label: string;
}
export interface Repo {
  id: string;
  accountId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  selected: boolean;
  permission: 'write' | 'read' | 'denied';
}
export interface InputSpec {
  name: string;
  label: string;
  type: 'string' | 'boolean' | 'choice' | 'number' | 'environment';
  required: boolean;
  default?: InputValue;
  options: string[];
}
export interface Workflow {
  id: number;
  repoId: string;
  name: string;
  path: string;
  dispatch: boolean;
  inputs: InputSpec[];
  refs: string[];
}
export interface Run {
  id: number;
  repoId: string;
  workflowId: number;
  name: string;
  branch: string;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting';
  conclusion: 'success' | 'failure' | 'cancelled' | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}
export interface Pin {
  id: string;
  label: string;
  accountId: string;
  repoId: string;
  workflowId: number;
  ref: string;
  inputs: Record<string, InputValue>;
  quickStart: boolean;
}
export interface Snapshot {
  accounts: Account[];
  repos: Repo[];
  workflows: Workflow[];
  runs: Run[];
  pins: Pin[];
  mode: 'demo' | 'live';
  connectivity: 'online' | 'offline' | 'forbidden';
  updatedAt: string;
  stale: boolean;
  message?: string | undefined;
  /** Targets locked after a start with unknown outcome; omitted when none. */
  uncertainStarts?: UncertainStart[];
}
/** One workflow on one ref of one account's repository. */
export interface DispatchTarget {
  accountId: string;
  repoId: string;
  workflowId: number;
  ref: string;
}
/** A persisted start claim; stays locked until released explicitly. */
export interface UncertainStart extends DispatchTarget {
  /** RFC 3339 claim time; null for claims written by older builds. */
  claimedAt: string | null;
}
export interface DispatchRequest {
  accountId: string;
  repoId: string;
  workflowId: number;
  ref: string;
  inputs: Record<string, InputValue>;
  requestId: string;
}
export interface DispatchOutcome {
  state: 'accepted' | 'uncertain' | 'rejected';
  runId?: number;
  htmlUrl?: string;
  message: string;
}
export type DemoScenario = 'normal' | 'offline' | 'forbidden' | 'uncertain';
/** Mirrors `LocalAccount` in src-tauri/src/local_auth.rs; secrets never cross IPC. */
export interface LocalAccount {
  /** `gh` accounts can be imported; `gcm` entries are metadata only. */
  source: 'gh' | 'gcm';
  host: string;
  login: string;
  usable: boolean;
  active: boolean;
  detail: string;
  actionsRead: string;
  actionsWrite: string;
}
/** Mirrors `LocalDiscovery` in src-tauri/src/local_auth.rs. */
export interface LocalDiscovery {
  accounts: LocalAccount[];
  notices: string[];
}
/** Mirrors `BrowserConfig` in src-tauri/src/browser_auth.rs. */
export interface BrowserConfig {
  configured: boolean;
}
/** Mirrors `DeviceFlowStatus` in src-tauri/src/auth.rs; times are Unix seconds. */
export type DeviceFlowStatus =
  | { state: 'idle' | 'completed' | 'cancelled' | 'expired' | 'denied' }
  | {
      state: 'awaitingAuthorization';
      userCode: string;
      verificationUri: string;
      expiresAt: number;
      nextPollAt: number;
    };
/** Mirrors `BrowserReply` in src-tauri/src/desktop_auth.rs; absent values arrive as `null`. */
export interface BrowserReply {
  flowId: number;
  status: DeviceFlowStatus;
  message: string | null;
  snapshot: Snapshot | null;
}
/** Mirrors `StartupStatus` and its `Status` in src-tauri/src/startup.rs. */
export interface StartupStatus {
  status:
    | 'unsupported'
    | 'disabled'
    | 'enabled'
    | 'disabledByWindows'
    | 'unknownApproval'
    | 'conflict';
  registered: boolean;
}
/**
 * `install`: a signed package is downloaded, verified and installed in the app.
 * `notify`: unsigned builds only open the release page; installation is manual.
 * Mirrors `UpdateMode` in src-tauri/src/updates.rs.
 */
export type UpdateMode = 'install' | 'notify';
/** Mirrors `UpdateInfo` in src-tauri/src/updates.rs. */
export interface UpdateInfo {
  mode: UpdateMode;
  version: string;
  notes: string;
  /** RFC 3339 UTC publication time, when known. */
  date: string | null;
}
/** Mirrors `DownloadProgress` in src-tauri/src/desktop_updates.rs. */
export interface DownloadProgress {
  downloaded: number;
  total: number | null;
  stage: 'downloading' | 'verifying';
}
