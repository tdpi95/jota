// WebDAV SyncProvider (PLAN.md "Remote & cloud sync" #3, milestone 29).
// Pushes/pulls individual files directly to/from a WebDAV server over HTTP
// using the `webdav` npm client — unlike gitRemote.ts, this has no
// dependency on a local `git` binary at all (PROGRESS.md's "WebDAV sync
// design" decision log): a workspace with git uninstalled can still push/
// pull fully, it just doesn't get the local undo/History-panel feature.
//
// Conflicts are surfaced, never auto-resolved, matching gitRemote.ts's own
// principle — but WebDAV has no merge/diff concept to lean on, so detection
// is a per-file three-way compare against a stored baseline snapshot (this
// file's local mtime + the server's etag at the last successful sync,
// cached at `<workspace>/.poco/cache/webdav-sync-state.json`, gitignored
// like index.sqlite3 — safe to delete, at the cost of every file being
// re-diffed as if never synced on the next push/pull). A file changed on
// both sides since that baseline is left untouched on both ends and
// reported as a conflict rather than guessed at.

import fs from 'node:fs';
import path from 'node:path';

import { createClient, type FileStat, type WebDAVClient } from 'webdav';

export interface WebDavConfig {
  url: string;
  username: string;
  password: string;
}

export interface WebDavSyncResult {
  /** Workspace-relative, forward-slashed paths that were actually
   * uploaded/downloaded/deleted this call. */
  synced: string[];
  /** Workspace-relative, forward-slashed paths left untouched on both sides
   * because both changed since the last synced baseline. */
  conflicts: string[];
}

export interface WebDavStatus {
  toPush: number;
  toPull: number;
  conflicts: string[];
  lastSyncedAt: string | null;
}

function createWebDavClient(config: WebDavConfig): WebDAVClient {
  return createClient(config.url, { username: config.username, password: config.password });
}

// --- ignore rules -----------------------------------------------------
// Same "skip files that don't match the expected naming pattern" tolerance
// PLAN.md already documents for passive filesystem sync — a sync-conflict
// artifact or stray file is skipped, not errored on or uploaded. `.git` and
// `.poco` are this workspace's own local machinery (undo history, index/
// backup cache), never vault content, so they're never synced either way —
// syncing `.git` as plain files would risk corrupting a *different*
// machine's independent local git repo on pull (PLAN.md).

const CONFLICTED_COPY_RE = /\(conflicted copy\b/i;

function shouldSyncName(name: string): boolean {
  return !name.startsWith('.') && !CONFLICTED_COPY_RE.test(name);
}

// --- local file listing -------------------------------------------------

/** Workspace-relative, forward-slashed path -> mtime (ms). */
function listLocalFiles(workspacePath: string): Map<string, number> {
  const files = new Map<string, number>();
  function walk(dir: string, relDir: string): void {
    for (const name of fs.readdirSync(dir)) {
      if (!shouldSyncName(name)) continue;
      const abs = path.join(dir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) walk(abs, rel);
      else if (st.isFile()) files.set(rel, st.mtimeMs);
    }
  }
  walk(workspacePath, '');
  return files;
}

// --- remote file listing -------------------------------------------------
// Manual per-directory recursion, not `getDirectoryContents(path, {deep:
// true})` — confirmed empirically (a real webdav-server instance) that a
// `Depth: infinity` PROPFIND from the root can 403 even with full read
// rights, matching real-world server behavior (many WebDAV servers,
// including Apache mod_dav, restrict it per RFC 4918 §9.1). A depth-1 walk
// per directory is the portable choice, at the cost of one round trip per
// directory instead of one for the whole tree.

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status?: number }).status === 404;
}

/** Workspace-relative, forward-slashed path -> etag (falls back to
 * `lastmod` for a server that doesn't expose etags). */
async function listRemoteFiles(client: WebDAVClient): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(remoteDir: string): Promise<void> {
    let entries: FileStat[];
    try {
      entries = await client.getDirectoryContents(remoteDir);
    } catch (err) {
      if (isNotFound(err)) return; // nothing uploaded to this branch yet
      throw err;
    }
    for (const entry of entries) {
      if (!shouldSyncName(entry.basename)) continue;
      if (entry.type === 'directory') {
        await walk(entry.filename);
      } else {
        files.set(entry.filename.replace(/^\/+/, ''), entry.etag ?? entry.lastmod);
      }
    }
  }
  await walk('/');
  return files;
}

function toRemotePath(relPath: string): string {
  return `/${relPath}`;
}

async function ensureRemoteDir(client: WebDAVClient, relDir: string): Promise<void> {
  if (relDir === '.' || relDir === '') return;
  await client.createDirectory(toRemotePath(relDir), { recursive: true });
}

// --- sync-state baseline (per-file, three-way conflict detection) -------

interface FileBaseline {
  localMtimeMs: number;
  remoteEtag: string;
}

type SyncState = Record<string, FileBaseline>;

function syncStateFilePath(workspacePath: string): string {
  return path.join(workspacePath, '.poco', 'cache', 'webdav-sync-state.json');
}

function loadSyncState(workspacePath: string): SyncState {
  try {
    return JSON.parse(fs.readFileSync(syncStateFilePath(workspacePath), 'utf8')) as SyncState;
  } catch {
    return {}; // missing/corrupt state self-heals: every file re-diffs as if never synced
  }
}

function saveSyncState(workspacePath: string, state: SyncState): void {
  const file = syncStateFilePath(workspacePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
}

// --- three-way diff -------------------------------------------------------

type FileState = 'created' | 'modified' | 'deleted' | 'same';

interface DiffEntry {
  path: string;
  local: FileState;
  remote: FileState;
}

/** A path with no stored baseline that exists on only one side is
 * `'created'` on that side and (trivially) `'same'` on the other, since
 * there's nothing to compare against — never guessed at as a conflict. A
 * path with no baseline present differently on *both* sides is `'created'`
 * on both, which the caller treats as a conflict — the safe default PLAN.md
 * calls for when there's no baseline to reason from. */
function classify(currentVal: number | string | undefined, baselineVal: number | string | undefined): FileState {
  if (baselineVal === undefined) return currentVal === undefined ? 'same' : 'created';
  if (currentVal === undefined) return 'deleted';
  return currentVal === baselineVal ? 'same' : 'modified';
}

function computeDiff(local: Map<string, number>, remote: Map<string, string>, baseline: SyncState): DiffEntry[] {
  const paths = new Set<string>([...local.keys(), ...remote.keys(), ...Object.keys(baseline)]);
  const entries: DiffEntry[] = [];
  for (const p of paths) {
    const b = baseline[p];
    const localState = classify(local.get(p), b?.localMtimeMs);
    const remoteState = classify(remote.get(p), b?.remoteEtag);
    if (localState === 'same' && remoteState === 'same') continue;
    entries.push({ path: p, local: localState, remote: remoteState });
  }
  return entries;
}

function etagOf(stat: FileStat): string {
  return stat.etag ?? stat.lastmod;
}

// --- push / pull / status --------------------------------------------------
// `push` acts on every entry where the *local* side changed; `pull` acts on
// every entry where the *remote* side changed. Either direction treats "both
// sides changed since the baseline" as a conflict and leaves both sides
// untouched — except "both sides deleted the same file", which is agreement,
// not a conflict, and just clears the now-pointless baseline entry.

export async function push(workspacePath: string, config: WebDavConfig): Promise<WebDavSyncResult> {
  const client = createWebDavClient(config);
  const local = listLocalFiles(workspacePath);
  const remote = await listRemoteFiles(client);
  const baseline = loadSyncState(workspacePath);
  const diff = computeDiff(local, remote, baseline);

  const synced: string[] = [];
  const conflicts: string[] = [];

  for (const entry of diff) {
    if (entry.local === 'same') continue;
    if (entry.local === 'deleted' && entry.remote === 'deleted') {
      delete baseline[entry.path];
      continue;
    }
    if (entry.remote !== 'same') {
      conflicts.push(entry.path);
      continue;
    }
    if (entry.local === 'deleted') {
      await client.deleteFile(toRemotePath(entry.path));
      delete baseline[entry.path];
    } else {
      const abs = path.join(workspacePath, ...entry.path.split('/'));
      const data = fs.readFileSync(abs);
      await ensureRemoteDir(client, path.posix.dirname(entry.path));
      await client.putFileContents(toRemotePath(entry.path), data, { overwrite: true });
      const stat = await client.stat(toRemotePath(entry.path));
      baseline[entry.path] = { localMtimeMs: local.get(entry.path)!, remoteEtag: etagOf(stat as FileStat) };
    }
    synced.push(entry.path);
  }

  saveSyncState(workspacePath, baseline);
  return { synced, conflicts };
}

export async function pull(workspacePath: string, config: WebDavConfig): Promise<WebDavSyncResult> {
  const client = createWebDavClient(config);
  const local = listLocalFiles(workspacePath);
  const remote = await listRemoteFiles(client);
  const baseline = loadSyncState(workspacePath);
  const diff = computeDiff(local, remote, baseline);

  const synced: string[] = [];
  const conflicts: string[] = [];

  for (const entry of diff) {
    if (entry.remote === 'same') continue;
    if (entry.local === 'deleted' && entry.remote === 'deleted') {
      delete baseline[entry.path];
      continue;
    }
    if (entry.local !== 'same') {
      conflicts.push(entry.path);
      continue;
    }
    const abs = path.join(workspacePath, ...entry.path.split('/'));
    if (entry.remote === 'deleted') {
      fs.rmSync(abs, { force: true });
      delete baseline[entry.path];
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const data = (await client.getFileContents(toRemotePath(entry.path))) as Buffer;
      fs.writeFileSync(abs, data);
      const mtimeMs = fs.statSync(abs).mtimeMs;
      baseline[entry.path] = { localMtimeMs: mtimeMs, remoteEtag: remote.get(entry.path)! };
    }
    synced.push(entry.path);
  }

  saveSyncState(workspacePath, baseline);
  return { synced, conflicts };
}

export async function status(workspacePath: string, config: WebDavConfig, lastSyncedAt: string | null): Promise<WebDavStatus> {
  const client = createWebDavClient(config);
  const local = listLocalFiles(workspacePath);
  const remote = await listRemoteFiles(client);
  const baseline = loadSyncState(workspacePath);
  const diff = computeDiff(local, remote, baseline);

  let toPush = 0;
  let toPull = 0;
  const conflicts: string[] = [];
  for (const entry of diff) {
    if (entry.local === 'deleted' && entry.remote === 'deleted') continue;
    if (entry.local !== 'same' && entry.remote !== 'same') {
      conflicts.push(entry.path);
    } else if (entry.local !== 'same') {
      toPush++;
    } else if (entry.remote !== 'same') {
      toPull++;
    }
  }

  return { toPush, toPull, conflicts, lastSyncedAt };
}
