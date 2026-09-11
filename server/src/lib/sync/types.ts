// Remote sync abstraction (PLAN.md "Remote & cloud sync", milestone 6).
// `gitRemote.ts` is the only v1 implementation of this interface — a later
// provider (Google Drive, WebDAV, ...) slots in here without touching the
// workspace/vault model, per PLAN.md.

/** One file path per conflicted entry, relative to the workspace root. */
export interface SyncConflict {
  conflict: true;
  files: string[];
}

export interface SyncOk {
  conflict: false;
}

export type PullResult = SyncOk | SyncConflict;

export interface SyncStatus {
  remoteUrl: string | null;
  /** Commits on the local branch not yet on the remote-tracking branch, or
   * null if that can't be determined (no remote configured, never fetched). */
  ahead: number | null;
  /** Commits on the remote-tracking branch not yet merged locally, same
   * null semantics as `ahead`. */
  behind: number | null;
  /** True if the working tree has uncommitted changes. */
  dirty: boolean;
  /** ISO8601 UTC, last time push/pull succeeded against this remote, or null. */
  lastSyncedAt: string | null;
}

export interface SyncProvider {
  getRemote(workspacePath: string): string | null;
  setRemote(workspacePath: string, url: string): void;
  push(workspacePath: string): void;
  pull(workspacePath: string): PullResult;
  status(workspacePath: string, lastSyncedAt: string | null): SyncStatus;
}
