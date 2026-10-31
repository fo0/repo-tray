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
  message?: string;
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
