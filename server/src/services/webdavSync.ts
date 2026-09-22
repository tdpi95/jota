// WebDAV sync service (PLAN.md "Remote & cloud sync" #3, milestone 29) — the
// one implementation routes/webdavSync.ts calls into. Bridges the workspace
// registry's `sync` field (persisted url/username/password + last-synced
// timestamp) with the push/pull/status engine in lib/sync/webdav.ts. Mirrors
// services/sync.ts's shape for the git-remote provider.

import os from 'node:os';

import { HttpError } from '../lib/httpError.js';
import { reconcileWorkspace } from '../lib/index/reindex.js';
import * as webdav from '../lib/sync/webdav.js';
import type { WebDavStatus, WebDavSyncResult, WebDavTestResult } from '../lib/sync/webdav.js';
import { readRegistry, writeRegistry, type WorkspaceSyncConfig } from '../lib/workspaces.js';
import { getActiveWorkspaceOrThrow } from './workspaces.js';

export class WebdavSyncServiceError extends HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'WebdavSyncServiceError';
  }
}

/** Persists a new `lastSyncedAt` for the active workspace's sync config
 * after a successful push/pull, same convention as services/sync.ts. */
function touchLastSyncedAt(workspaceId: string, homeDir: string): void {
  const registry = readRegistry(homeDir);
  const entry = registry.workspaces.find((w) => w.id === workspaceId);
  if (entry?.sync?.provider === 'webdav') {
    entry.sync = { ...entry.sync, lastSyncedAt: new Date().toISOString() };
    writeRegistry(registry, homeDir);
  }
}

export function getConfig(homeDir: string = os.homedir()): WorkspaceSyncConfig {
  const workspace = getActiveWorkspaceOrThrow(homeDir);
  return workspace.sync ?? { provider: 'none' };
}

/** `PUT /api/vault/webdav/config` — sets this workspace's active sync
 * provider to WebDAV, replacing whatever was configured before (PLAN.md's
 * "one provider active per workspace" model — this does not touch a
 * previously-configured git-remote `origin`, it just stops being what the
 * app treats as active). Credentials are stored in plain text, same trust
 * model already accepted for git-remote's `remoteUrl`. */
export function setConfig(
  input: { url: string; username: string; password: string },
  homeDir: string = os.homedir()
): WorkspaceSyncConfig {
  const url = input.url?.trim();
  const username = input.username?.trim();
  if (!url) throw new WebdavSyncServiceError('url is required', 400);
  if (!username) throw new WebdavSyncServiceError('username is required', 400);
  if (!input.password) throw new WebdavSyncServiceError('password is required', 400);

  const workspace = getActiveWorkspaceOrThrow(homeDir);
  const registry = readRegistry(homeDir);
  const entry = registry.workspaces.find((w) => w.id === workspace.id);
  if (!entry) throw new WebdavSyncServiceError(`no workspace with id ${workspace.id}`, 404);

  // A URL change means a genuinely different remote target — the previous
  // baseline (per-file mtime/etag from the last sync) is meaningless, and
  // dangerous, against it: see webdav.ts's `resetSyncState` for why a stale
  // baseline can make a pull delete local files that were simply never on
  // the new remote. Only the URL matters here, not username/password —
  // rotating credentials for the same target should keep the baseline.
  const previousUrl = entry.sync?.provider === 'webdav' ? entry.sync.url : null;
  const urlChanged = previousUrl !== url;

  const sync: WorkspaceSyncConfig = {
    provider: 'webdav',
    url,
    username,
    password: input.password,
    lastSyncedAt: entry.sync?.provider === 'webdav' && !urlChanged ? entry.sync.lastSyncedAt : null,
  };
  entry.sync = sync;
  writeRegistry(registry, homeDir);
  if (urlChanged) webdav.resetSyncState(workspace.path);
  return sync;
}

/** `POST /api/vault/webdav/test` — tests the given credentials directly
 * (the Settings form's current draft, not necessarily the saved config, and
 * not scoped to any workspace at all — this never touches the registry).
 * A failed test is returned as data (`{ok: false, ...}`), not thrown, same
 * as a pull's conflict result — it's an expected, actionable outcome for
 * the caller to render, not a service failure. */
export async function testConnection(input: { url: string; username: string; password: string }): Promise<WebDavTestResult> {
  const url = input.url?.trim();
  const username = input.username?.trim();
  if (!url) throw new WebdavSyncServiceError('url is required', 400);
  if (!username) throw new WebdavSyncServiceError('username is required', 400);
  if (!input.password) throw new WebdavSyncServiceError('password is required', 400);
  return webdav.testConnection({ url, username, password: input.password });
}

function requireWebdavConfig(homeDir: string): {
  id: string;
  path: string;
  config: { url: string; username: string; password: string };
  lastSyncedAt: string | null;
} {
  const workspace = getActiveWorkspaceOrThrow(homeDir);
  if (workspace.sync?.provider !== 'webdav') {
    throw new WebdavSyncServiceError('no WebDAV connection configured for this workspace — set one first', 400);
  }
  const { url, username, password, lastSyncedAt } = workspace.sync;
  return { id: workspace.id, path: workspace.path, config: { url, username, password }, lastSyncedAt };
}

/** `POST /api/vault/webdav/push`. */
export async function push(homeDir: string = os.homedir()): Promise<WebDavSyncResult> {
  const workspace = requireWebdavConfig(homeDir);
  let result: WebDavSyncResult;
  try {
    result = await webdav.push(workspace.path, workspace.config);
  } catch (err) {
    throw new WebdavSyncServiceError(`push failed: ${(err as Error).message}`, 502);
  }
  touchLastSyncedAt(workspace.id, homeDir);
  return result;
}

/** `POST /api/vault/webdav/pull`. Re-reconciles the index for whatever
 * changed, same pattern services/sync.ts's `pull` already established. */
export async function pull(homeDir: string = os.homedir()): Promise<WebDavSyncResult> {
  const workspace = requireWebdavConfig(homeDir);
  let result: WebDavSyncResult;
  try {
    result = await webdav.pull(workspace.path, workspace.config);
  } catch (err) {
    throw new WebdavSyncServiceError(`pull failed: ${(err as Error).message}`, 502);
  }
  touchLastSyncedAt(workspace.id, homeDir);
  if (result.synced.length > 0) reconcileWorkspace(workspace.path);
  return result;
}

/** `GET /api/vault/webdav/status`. Read-only — never touches `lastSyncedAt`. */
export async function getStatus(homeDir: string = os.homedir()): Promise<WebDavStatus> {
  const workspace = requireWebdavConfig(homeDir);
  try {
    return await webdav.status(workspace.path, workspace.config, workspace.lastSyncedAt);
  } catch (err) {
    throw new WebdavSyncServiceError(`status failed: ${(err as Error).message}`, 502);
  }
}
