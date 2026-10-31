export interface UpdateInfo {
  version: string;
  notes: string;
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing';

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
  stage: 'downloading' | 'verifying';
}
