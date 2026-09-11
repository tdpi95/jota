// Remote sync service (PLAN.md "Remote & cloud sync" #1, milestone 6) — the
// one implementation `routes/sync.ts` and (later) any MCP tool call into.
// Bridges the workspace registry's `sync` field (persisted remote URL +
// last-synced timestamp) with the `SyncProvider` in lib/sync/gitRemote.ts.

import os from 'node:os';

import { HttpError } from '../lib/httpError.js';
import { reconcileWorkspace } from '../lib/index/reindex.js';
import * as gitRemote from '../lib/sync/gitRemote.js';
import type { PullResult, SyncStatus } from '../lib/sync/types.js';
import { readRegistry, writeRegistry, type WorkspaceSyncConfig } from '../lib/workspaces.js';
import { getActiveWorkspaceOrThrow } from './workspaces.js';

export class SyncServiceError extends HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'SyncServiceError';
  }
}

function lastSyncedAtOf(sync: WorkspaceSyncConfig | undefined): string | null {
  return sync?.provider === 'git-remote' ? sync.lastSyncedAt : null;
}

/** Persists a new `lastSyncedAt` for the active workspace's sync config after
 * a successful push/pull. Best-effort against a concurrent registry write is
 * not a concern here — the registry is single-writer (this process). */
function touchLastSyncedAt(workspaceId: string, homeDir: string): void {
  const registry = readRegistry(homeDir);
  const entry = registry.workspaces.find((w) => w.id === workspaceId);
  if (entry?.sync?.provider === 'git-remote') {
    entry.sync = { ...entry.sync, lastSyncedAt: new Date().toISOString() };
    writeRegistry(registry, homeDir);
  }
}

export function getRemote(homeDir: string = os.homedir()): WorkspaceSyncConfig {
  const workspace = getActiveWorkspaceOrThrow(homeDir);
  return workspace.sync ?? { provider: 'none' };
}

/** `PUT /api/vault/git/remote` — sets (or updates) the workspace's `origin`
 * remote and records it in the registry. */
export function setRemote(url: string, homeDir: string = os.homedir()): WorkspaceSyncConfig {
  if (!url || url.trim() === '') throw new SyncServiceError('url is required', 400);
  const workspace = getActiveWorkspaceOrThrow(homeDir);

  gitRemote.setRemote(workspace.path, url.trim());

  const registry = readRegistry(homeDir);
  const entry = registry.workspaces.find((w) => w.id === workspace.id);
  if (!entry) throw new SyncServiceError(`no workspace with id ${workspace.id}`, 404);
  const sync: WorkspaceSyncConfig = { provider: 'git-remote', remoteUrl: url.trim(), lastSyncedAt: lastSyncedAtOf(entry.sync) };
  entry.sync = sync;
  writeRegistry(registry, homeDir);
  return sync;
}

function requireRemote(homeDir: string): { path: string; id: string } {
  const workspace = getActiveWorkspaceOrThrow(homeDir);
  if (!gitRemote.getRemote(workspace.path)) {
    throw new SyncServiceError('no remote configured for this workspace — set one first', 400);
  }
  return workspace;
}

/** `POST /api/vault/git/push`. */
export function push(homeDir: string = os.homedir()): void {
  const workspace = requireRemote(homeDir);
  try {
    gitRemote.push(workspace.path);
  } catch (err) {
    throw new SyncServiceError(`push failed: ${(err as Error).message}`, 502);
  }
  touchLastSyncedAt(workspace.id, homeDir);
}

/**
 * `POST /api/vault/git/pull`. A conflict is returned as data (PullResult),
 * not thrown — it's an expected outcome for the caller to surface to the
 * user, not a service failure. On a clean pull, re-reconciles the index for
 * whatever changed (PLAN.md "Recovery surface" applies the same pattern to
 * revert).
 */
export function pull(homeDir: string = os.homedir()): PullResult {
  const workspace = requireRemote(homeDir);
  let result: PullResult;
  try {
    result = gitRemote.pull(workspace.path);
  } catch (err) {
    throw new SyncServiceError(`pull failed: ${(err as Error).message}`, 502);
  }
  if (!result.conflict) {
    touchLastSyncedAt(workspace.id, homeDir);
    reconcileWorkspace(workspace.path);
  }
  return result;
}

/** `GET /api/vault/git/status`. */
export function getStatus(homeDir: string = os.homedir()): SyncStatus {
  const workspace = getActiveWorkspaceOrThrow(homeDir);
  return gitRemote.status(workspace.path, lastSyncedAtOf(workspace.sync));
}
