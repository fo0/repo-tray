/**
 * `install`: a signed package is downloaded, verified and installed in the app.
 * `notify`: unsigned builds only open the release page; installation is manual.
 * Mirrors `UpdateMode` in src-tauri/src/updates.rs.
 */
export type UpdateMode = 'install' | 'notify';

/** Mirrors `UpdateInfo` in src-tauri/src/updates.rs (camelCase JSON). */
export interface UpdateInfo {
  mode: UpdateMode;
  version: string;
  notes: string;
  /** RFC 3339 UTC publication time, when known. */
  date: string | null;
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

/** German date of a release, or an empty string when unknown or malformed. */
export function releaseDate(value: string | null): string {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '';
}
