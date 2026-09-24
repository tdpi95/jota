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
// cached at `<workspace>/.jota/cache/webdav-sync-state.json`, gitignored
// like index.sqlite3 — safe to delete, at the cost of every file being
// re-diffed as if never synced on the next push/pull). A file changed on
// both sides since that baseline is left untouched on both ends and
// reported as a conflict rather than guessed at.

import fs from 'node:fs';
import path from 'node:path';

import { createClient, type FileStat, type WebDAVClient } from 'webdav';

import { diffHunks, merge2, merge3, type DiffHunk, type MergeChunk } from '../textMerge.js';
import { isInFileHistory } from '../vaultGit.js';

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

/** One file a push/pull would act on, and what it would do to it. */
export interface WebDavPendingChange {
  path: string;
  change: 'added' | 'modified' | 'deleted';
}

export interface WebDavStatus {
  toPush: number;
  toPull: number;
  /** Exactly what `push`/`pull` would transfer right now (same length as
   * `toPush`/`toPull`), sorted by path — backs Settings' clickable counts. */
  pushFiles: WebDavPendingChange[];
  pullFiles: WebDavPendingChange[];
  conflicts: string[];
  lastSyncedAt: string | null;
}

function createWebDavClient(config: WebDavConfig): WebDAVClient {
  return createClient(config.url, { username: config.username, password: config.password });
}

export type WebDavTestResult =
  | { ok: true }
  | { ok: false; reason: 'auth' | 'not-found' | 'other'; message: string };

/** `PUT /api/vault/webdav/config`'s "Test connection" button — a single
 * `PROPFIND` against the configured URL, distinguishing "wrong credentials"
 * from "reachable, but that folder doesn't exist yet on the server" (the
 * Settings panel tells the user to create the target folder themselves
 * first, so this is a common, actionable first-try result, not a generic
 * failure) from anything else (host unreachable, TLS error, ...). Never
 * throws — the result is data for the caller to render, same as a pull's
 * conflict list. */
export async function testConnection(config: WebDavConfig): Promise<WebDavTestResult> {
  const client = createWebDavClient(config);
  try {
    await client.getDirectoryContents('/');
    return { ok: true };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      return { ok: false, reason: 'auth', message: 'Authentication failed — check the username and password.' };
    }
    if (status === 404) {
      return { ok: false, reason: 'not-found', message: "Reached the server, but that folder doesn't exist yet — create it there first." };
    }
    return { ok: false, reason: 'other', message: (err as Error).message || 'Could not reach the server.' };
  }
}

// --- ignore rules -----------------------------------------------------
// Same "skip files that don't match the expected naming pattern" tolerance
// PLAN.md already documents for passive filesystem sync — a sync-conflict
// artifact or stray file is skipped, not errored on or uploaded. `.git` and
// `.jota` are this workspace's own local machinery (undo history, index/
// backup cache), never vault content, so they're never synced either way —
// syncing `.git` as plain files would risk corrupting a *different*
// machine's independent local git repo on pull (PLAN.md).

const CONFLICTED_COPY_RE = /\(conflicted copy\b/i;

function shouldSyncName(name: string): boolean {
  return !name.startsWith('.') && !CONFLICTED_COPY_RE.test(name);
}

/** Same check, applied to every segment of a relative path — needed once
 * `listRemoteFiles` below can list a directory's contents *without* ever
 * visiting its ancestors individually (a deep listing): checking only a
 * given entry's own `basename` would miss e.g. `.git/objects/ab/c123`,
 * since `c123` itself doesn't start with a dot even though `.git` does. */
function shouldSyncPath(relPath: string): boolean {
  return relPath.split('/').every(shouldSyncName);
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
// `getDirectoryContents('/', {deep: true})` (a single `Depth: infinity`
// PROPFIND) is tried first — confirmed empirically against a real Nextcloud
// instance that it works and is dramatically faster (one round trip for an
// entire tree vs. one per directory: ~1.5s for 116 entries, vs. 6+ seconds
// walking 8 directories one level at a time — the dominant cost behind a
// live report, "still don't update immediately", once the concurrency fix
// below turned out not to be the whole story). But it isn't universal:
// also confirmed empirically that a lightweight test server (`webdav-
// server`, used by webdav.test.ts) 403s the exact same request even with
// full read rights, matching documented real-world variance (some servers
// restrict `Depth: infinity` per RFC 4918 §9.1). So a failed deep listing
// falls back to the portable depth-1-per-directory walk instead of failing
// the whole operation — slower on a server that doesn't support it, but
// correct everywhere.

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status?: number }).status === 404;
}

/** How many WebDAV round trips (sibling directory listings, or ambiguous-
 * file content compares — see `computeDiff` below) to run at once. A plain
 * sequential walk of either was the first cut of this code, and against a
 * real remote server (meaningful per-request latency, not the near-zero
 * latency of an in-process test server) that meant one directory listing —
 * or one file fetch-and-compare — at a time, however many there were: a
 * real, noticeable multi-second stall reported live ("still don't update
 * immediately"), traced to exactly this. Bounded instead of an unbounded
 * `Promise.all` so a large vault doesn't open hundreds of concurrent
 * connections against the server at once. */
const WEBDAV_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function addRemoteEntry(files: Map<string, string>, entry: FileStat): void {
  if (entry.type === 'directory') return;
  const rel = entry.filename.replace(/^\/+/, '');
  if (!shouldSyncPath(rel)) return;
  files.set(rel, entry.etag ?? entry.lastmod);
}

/** Workspace-relative, forward-slashed path -> etag (falls back to
 * `lastmod` for a server that doesn't expose etags). Tries one deep
 * (`Depth: infinity`) listing first; if the server rejects that, falls
 * back to a depth-1 walk with sibling directories at each level listed
 * concurrently (bounded, see `WEBDAV_CONCURRENCY`) rather than one at a
 * time. */
async function listRemoteFiles(client: WebDAVClient): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  try {
    const entries = await client.getDirectoryContents('/', { deep: true });
    for (const entry of entries) addRemoteEntry(files, entry);
    return files;
  } catch (err) {
    if (isNotFound(err)) return files; // nothing uploaded yet at all
    // Any other error (commonly a 403/501 for a server that restricts
    // `Depth: infinity`) falls through to the portable walk below.
  }

  async function walk(remoteDir: string): Promise<void> {
    let entries: FileStat[];
    try {
      entries = await client.getDirectoryContents(remoteDir);
    } catch (err) {
      if (isNotFound(err)) return; // nothing uploaded to this branch yet
      throw err;
    }
    const subdirs: string[] = [];
    for (const entry of entries) {
      if (!shouldSyncName(entry.basename)) continue;
      if (entry.type === 'directory') {
        subdirs.push(entry.filename);
      } else {
        addRemoteEntry(files, entry);
      }
    }
    await mapWithConcurrency(subdirs, WEBDAV_CONCURRENCY, walk);
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
  return path.join(workspacePath, '.jota', 'cache', 'webdav-sync-state.json');
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

/** Called (by `services/webdavSync.ts`'s `setConfig`) whenever the
 * configured WebDAV URL actually changes — the baseline is meaningless, and
 * actively dangerous, against a *different* remote: a file the baseline
 * says was already synced but that's missing on the new target reads as
 * "the remote deleted this," not "this is a new target," which would make
 * a `pull` delete every local file that isn't already up there. There's no
 * way to tell a genuinely empty/new remote apart from that without
 * resetting the baseline on every URL change. */
export function resetSyncState(workspacePath: string): void {
  fs.rmSync(syncStateFilePath(workspacePath), { force: true });
  fs.rmSync(baseSnapshotDir(workspacePath), { recursive: true, force: true });
}

// --- base snapshots (last-synced content, for the conflict view) ---------
// The mtime/etag baseline above says *whether* a file changed since the last
// sync, but not *what* — so for text files the last-synced bytes themselves
// are kept too, under `.jota/cache/webdav-base/<same relative path>`. That
// copy is what lets a conflict be shown as "changed on this device" vs.
// "changed on the server" and lets non-overlapping edits from both sides be
// pre-merged for the user (lib/textMerge.ts's `merge3`). Same cache
// contract as the state file: gitignored, derived, safe to delete — a
// missing snapshot just degrades that one file's conflict view to a
// two-way diff. Binary files (attachments) and anything over
// `MAX_BASE_SNAPSHOT_BYTES` are never snapshotted: there's no useful line
// diff to show for them, only "keep this side or that side".

const TEXT_FILE_RE = /\.(md|markdown|txt)$/i;
const MAX_BASE_SNAPSHOT_BYTES = 1024 * 1024;

function isTextPath(relPath: string): boolean {
  return TEXT_FILE_RE.test(relPath);
}

function baseSnapshotDir(workspacePath: string): string {
  return path.join(workspacePath, '.jota', 'cache', 'webdav-base');
}

function baseSnapshotPath(workspacePath: string, relPath: string): string {
  return path.join(baseSnapshotDir(workspacePath), ...relPath.split('/'));
}

function writeBaseSnapshot(workspacePath: string, relPath: string, data: Buffer): void {
  if (!isTextPath(relPath) || data.length > MAX_BASE_SNAPSHOT_BYTES) return;
  const file = baseSnapshotPath(workspacePath, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function readBaseSnapshot(workspacePath: string, relPath: string): string | null {
  try {
    return fs.readFileSync(baseSnapshotPath(workspacePath, relPath), 'utf8');
  } catch {
    return null;
  }
}

function readBaseSnapshotBytes(workspacePath: string, relPath: string): Buffer | null {
  try {
    return fs.readFileSync(baseSnapshotPath(workspacePath, relPath));
  } catch {
    return null;
  }
}

function removeBaseSnapshot(workspacePath: string, relPath: string): void {
  fs.rmSync(baseSnapshotPath(workspacePath, relPath), { force: true });
}

// --- three-way diff -------------------------------------------------------

export type FileState = 'created' | 'modified' | 'deleted' | 'same';

interface DiffEntry {
  path: string;
  local: FileState;
  remote: FileState;
}

/** A path with no stored baseline that exists on only one side is
 * `'created'` on that side and (trivially) `'same'` on the other, since
 * there's nothing to compare against — never guessed at as a conflict. A
 * path with no baseline present on *both* sides is `'created'` on both —
 * `computeDiff` below resolves that ambiguity by content before ever
 * treating it as a conflict, rather than guessing. */
function classify(currentVal: number | string | undefined, baselineVal: number | string | undefined): FileState {
  if (baselineVal === undefined) return currentVal === undefined ? 'same' : 'created';
  if (currentVal === undefined) return 'deleted';
  return currentVal === baselineVal ? 'same' : 'modified';
}

/**
 * A path with no baseline present on both sides (`created`/`created`) is
 * genuinely ambiguous from metadata alone — and a real, common case, not an
 * edge case: it's exactly what happens right after a baseline reset (a
 * WebDAV URL change, `.jota/cache` deleted, a second machine connecting to
 * an already-synced remote for the first time, ...) against a target that
 * already has the same content. Naively treating every such path as a
 * conflict — the original implementation's choice — turns a routine
 * reconnect into a wall of false conflicts. So before deciding, the actual
 * bytes are compared (concurrently, see `mapWithConcurrency` above):
 * identical content resolves silently (the baseline is recorded
 * immediately, mutating `baseline` in place, so the next call doesn't redo
 * the fetch), and only a genuine mismatch is left as a real conflict for
 * the caller to surface.
 */
async function computeDiff(
  workspacePath: string,
  client: WebDAVClient,
  local: Map<string, number>,
  remote: Map<string, string>,
  baseline: SyncState
): Promise<DiffEntry[]> {
  const paths = [...new Set<string>([...local.keys(), ...remote.keys(), ...Object.keys(baseline)])];
  const entries: DiffEntry[] = [];
  const ambiguous: string[] = [];

  for (const p of paths) {
    const b = baseline[p];
    const localState = classify(local.get(p), b?.localMtimeMs);
    const remoteState = classify(remote.get(p), b?.remoteEtag);
    if (localState === 'created' && remoteState === 'created') {
      ambiguous.push(p);
      continue;
    }
    if (localState === 'same' && remoteState === 'same') {
      // Unchanged on both sides since the last sync, so the local file *is*
      // the last-synced content — backfills a snapshot for a file synced
      // before snapshots existed, so its next conflict gets a three-way view.
      if (b && isTextPath(p) && !fs.existsSync(baseSnapshotPath(workspacePath, p))) {
        writeBaseSnapshot(workspacePath, p, fs.readFileSync(path.join(workspacePath, ...p.split('/'))));
      }
      continue;
    }
    entries.push({ path: p, local: localState, remote: remoteState });
  }

  const resolutions = await mapWithConcurrency(ambiguous, WEBDAV_CONCURRENCY, async (p) => {
    const abs = path.join(workspacePath, ...p.split('/'));
    const [localData, remoteData] = await Promise.all([fs.promises.readFile(abs), client.getFileContents(toRemotePath(p)) as Promise<Buffer>]);
    const identical = Buffer.isBuffer(localData) && Buffer.isBuffer(remoteData) && localData.equals(remoteData);
    return { path: p, identical, localData, remoteData };
  });

  for (const { path: p, identical, localData, remoteData } of resolutions) {
    if (identical) {
      baseline[p] = { localMtimeMs: local.get(p)!, remoteEtag: remote.get(p)! };
      writeBaseSnapshot(workspacePath, p, localData);
    } else if (isInFileHistory(workspacePath, p, remoteData)) {
      // See `refineBothChanged` below: the server's copy is an older version
      // of ours, so it's the common base and only the local side moved on.
      // `localMtimeMs: 0` never matches a real mtime, so the local side
      // keeps reading as `modified` until it's pushed.
      baseline[p] = { localMtimeMs: 0, remoteEtag: remote.get(p)! };
      writeBaseSnapshot(workspacePath, p, remoteData);
      entries.push({ path: p, local: 'modified', remote: 'same' });
    } else {
      entries.push({ path: p, local: 'created', remote: 'created' });
    }
  }

  await refineBothChanged(workspacePath, client, local, remote, baseline, entries);
  return entries.filter((e) => e.local !== 'same' || e.remote !== 'same');
}

/**
 * Metadata (mtime/etag) says *that* a side changed, not that its content
 * did — so before a `modified`/`modified` file is reported as a conflict,
 * the actual bytes get two cheaper-than-a-human checks, each of which can
 * only ever downgrade a side to `same` (never invent a change):
 *
 * 1. Against the base snapshot: a side whose content still equals the
 *    last-synced copy didn't really change (a touched file, a server that
 *    re-issued an etag after a rescan, ...).
 * 2. Against local git history: a server copy that's byte-for-byte some
 *    version this workspace already committed is just an older copy of
 *    ours, so the server has nothing new and only the local side moved on.
 *    Overwriting it on push can't lose anything, because that exact content
 *    is by definition still recoverable from this workspace's History. This
 *    is what keeps a lost/reset baseline (a deleted `.jota/cache`, or the
 *    Poco→Jota rename moving `.poco/` to `.jota/`) from turning every locally
 *    edited file into a false conflict (see also `computeDiff`'s no-baseline
 *    branch, which applies the same check).
 *
 * Mutates `entries` and `baseline` in place; the caller drops entries that
 * end up `same`/`same`.
 */
async function refineBothChanged(
  workspacePath: string,
  client: WebDAVClient,
  local: Map<string, number>,
  remote: Map<string, string>,
  baseline: SyncState,
  entries: DiffEntry[]
): Promise<void> {
  const candidates = entries.filter((e) => e.local === 'modified' && e.remote === 'modified');
  await mapWithConcurrency(candidates, WEBDAV_CONCURRENCY, async (entry) => {
    const p = entry.path;
    const abs = path.join(workspacePath, ...p.split('/'));
    const [localData, remoteData] = await Promise.all([fs.promises.readFile(abs), client.getFileContents(toRemotePath(p)) as Promise<Buffer>]);
    const b = baseline[p];

    if (localData.equals(remoteData)) {
      baseline[p] = { localMtimeMs: local.get(p)!, remoteEtag: remote.get(p)! };
      writeBaseSnapshot(workspacePath, p, localData);
      entry.local = 'same';
      entry.remote = 'same';
      return;
    }

    const base = isTextPath(p) ? readBaseSnapshotBytes(workspacePath, p) : null;
    if (base && remoteData.equals(base)) {
      b.remoteEtag = remote.get(p)!;
      entry.remote = 'same';
    } else if (base && localData.equals(base)) {
      b.localMtimeMs = local.get(p)!;
      entry.local = 'same';
    } else if (isInFileHistory(workspacePath, p, remoteData)) {
      b.remoteEtag = remote.get(p)!;
      writeBaseSnapshot(workspacePath, p, remoteData);
      entry.remote = 'same';
    }
  });
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
  const diff = await computeDiff(workspacePath, client, local, remote, baseline);

  const synced: string[] = [];
  const conflicts: string[] = [];

  for (const entry of diff) {
    if (entry.local === 'same') continue;
    if (entry.local === 'deleted' && entry.remote === 'deleted') {
      delete baseline[entry.path];
      removeBaseSnapshot(workspacePath, entry.path);
      continue;
    }
    if (entry.remote !== 'same') {
      conflicts.push(entry.path);
      continue;
    }
    if (entry.local === 'deleted') {
      await client.deleteFile(toRemotePath(entry.path));
      delete baseline[entry.path];
      removeBaseSnapshot(workspacePath, entry.path);
    } else {
      const abs = path.join(workspacePath, ...entry.path.split('/'));
      const data = fs.readFileSync(abs);
      await ensureRemoteDir(client, path.posix.dirname(entry.path));
      await client.putFileContents(toRemotePath(entry.path), data, { overwrite: true });
      const stat = await client.stat(toRemotePath(entry.path));
      baseline[entry.path] = { localMtimeMs: local.get(entry.path)!, remoteEtag: etagOf(stat as FileStat) };
      writeBaseSnapshot(workspacePath, entry.path, data);
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
  const diff = await computeDiff(workspacePath, client, local, remote, baseline);

  const synced: string[] = [];
  const conflicts: string[] = [];

  for (const entry of diff) {
    if (entry.remote === 'same') continue;
    if (entry.local === 'deleted' && entry.remote === 'deleted') {
      delete baseline[entry.path];
      removeBaseSnapshot(workspacePath, entry.path);
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
      removeBaseSnapshot(workspacePath, entry.path);
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const data = (await client.getFileContents(toRemotePath(entry.path))) as Buffer;
      fs.writeFileSync(abs, data);
      const mtimeMs = fs.statSync(abs).mtimeMs;
      baseline[entry.path] = { localMtimeMs: mtimeMs, remoteEtag: remote.get(entry.path)! };
      writeBaseSnapshot(workspacePath, entry.path, data);
    }
    synced.push(entry.path);
  }

  saveSyncState(workspacePath, baseline);
  return { synced, conflicts };
}

/** Read-only from the caller's perspective (never touches `lastSyncedAt`),
 * but does persist any baseline entries `computeDiff` resolves via a
 * content compare — a pure cache optimization (so a repeatedly-polled
 * status doesn't redo the same fetch/compare every time), not user-visible
 * state. */
export async function status(workspacePath: string, config: WebDavConfig, lastSyncedAt: string | null): Promise<WebDavStatus> {
  const client = createWebDavClient(config);
  const local = listLocalFiles(workspacePath);
  const remote = await listRemoteFiles(client);
  const baseline = loadSyncState(workspacePath);
  const diff = await computeDiff(workspacePath, client, local, remote, baseline);

  const pushFiles: WebDavPendingChange[] = [];
  const pullFiles: WebDavPendingChange[] = [];
  const conflicts: string[] = [];
  const change = (state: FileState): WebDavPendingChange['change'] => (state === 'created' ? 'added' : state === 'deleted' ? 'deleted' : 'modified');
  for (const entry of diff) {
    if (entry.local === 'deleted' && entry.remote === 'deleted') continue;
    if (entry.local !== 'same' && entry.remote !== 'same') {
      conflicts.push(entry.path);
    } else if (entry.local !== 'same') {
      pushFiles.push({ path: entry.path, change: change(entry.local) });
    } else if (entry.remote !== 'same') {
      pullFiles.push({ path: entry.path, change: change(entry.remote) });
    }
  }
  const byPath = (a: WebDavPendingChange, b: WebDavPendingChange) => a.path.localeCompare(b.path);
  pushFiles.sort(byPath);
  pullFiles.sort(byPath);
  conflicts.sort();

  saveSyncState(workspacePath, baseline);
  return { toPush: pushFiles.length, toPull: pullFiles.length, pushFiles, pullFiles, conflicts, lastSyncedAt };
}

// --- resolving a single conflict -------------------------------------------
// Push/pull never touch a conflicted file (above). Resolving one is its own
// explicit, per-file step: `getConflict` fetches both sides (plus the base
// snapshot, when there is one) and returns what changed on each side and a
// pre-merged draft; `resolveConflict` then applies the user's choice — keep
// this device's version, keep the server's, or a merged text they edited —
// to *both* sides and records a fresh baseline, so the file drops out of the
// conflict list. Both operate on just the one path (a local stat + a remote
// PROPFIND on that file), not a full-tree listing.

export interface WebDavFileVersion {
  /** Local mtime / remote etag as they were when the conflict was read —
   * `null` for a side where the file doesn't exist. `resolveConflict`
   * refuses to act if either has moved on since, so a resolution can never
   * overwrite an edit the user hasn't seen. */
  localMtimeMs: number | null;
  remoteEtag: string | null;
}

export interface WebDavConflictDetail {
  path: string;
  /** What happened on each side since the last sync. `created` on both
   * means the file had never been synced and exists on both sides with
   * different content. */
  local: FileState;
  remote: FileState;
  /** A text file (markdown) gets diffs + a merge draft; anything else
   * (attachments) only gets sizes and keep-one-side. */
  isText: boolean;
  /** Whether a last-synced copy was available: with one, `localChanges`/
   * `remoteChanges` show each side's own edits and `merge` has every
   * non-overlapping edit already combined; without, only a direct
   * this-device-vs-server comparison (`differences`) is possible. */
  hasBase: boolean;
  localSize: number | null;
  remoteSize: number | null;
  /** base → this device's version (three-way, the local file exists). */
  localChanges: DiffHunk[] | null;
  /** base → server's version (three-way, the remote file exists). */
  remoteChanges: DiffHunk[] | null;
  /** server's version → this device's version (two-way fallback, both exist). */
  differences: DiffHunk[] | null;
  /** Merge draft: both sides exist and it's text. `conflict` chunks are
   * exactly the regions the user has to choose between. */
  merge: MergeChunk[] | null;
  version: WebDavFileVersion;
}

export type WebDavResolution = { choice: 'local' } | { choice: 'remote' } | { choice: 'merged'; content: string };

export type WebDavResolveResult =
  | { ok: true; /** Whether the local file was written or deleted. */ localChanged: boolean }
  | { ok: false; reason: 'changed' | 'invalid'; message: string };

/** A workspace-relative path a caller may ask about: forward-slashed, no
 * `..`/absolute escapes, and one sync would actually act on (so never
 * anything under `.git`/`.jota`). */
export function isValidSyncPath(relPath: string): boolean {
  if (!relPath || relPath.startsWith('/') || relPath.includes('\\')) return false;
  const segments = relPath.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false;
  return shouldSyncPath(relPath);
}

interface PathSnapshot {
  local: FileState;
  remote: FileState;
  version: WebDavFileVersion;
  remoteSize: number | null;
}

async function snapshotPath(workspacePath: string, client: WebDAVClient, relPath: string, baseline: SyncState): Promise<PathSnapshot> {
  let localMtimeMs: number | null = null;
  try {
    const st = fs.statSync(path.join(workspacePath, ...relPath.split('/')));
    if (st.isFile()) localMtimeMs = st.mtimeMs;
  } catch {
    // missing locally
  }
  let remoteEtag: string | null = null;
  let remoteSize: number | null = null;
  try {
    const st = (await client.stat(toRemotePath(relPath))) as FileStat;
    if (st.type === 'file') {
      remoteEtag = etagOf(st);
      remoteSize = st.size;
    }
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  const b = baseline[relPath];
  return {
    local: classify(localMtimeMs ?? undefined, b?.localMtimeMs),
    remote: classify(remoteEtag ?? undefined, b?.remoteEtag),
    version: { localMtimeMs, remoteEtag },
    remoteSize,
  };
}

/** The conflict detail for one file, or `null` if it isn't (or is no
 * longer) in conflict — e.g. it was resolved from another device, or it had
 * no baseline and turned out to have identical content on both sides (in
 * which case the baseline is recorded, same as `computeDiff` does). */
export async function getConflict(workspacePath: string, config: WebDavConfig, relPath: string): Promise<WebDavConflictDetail | null> {
  const client = createWebDavClient(config);
  const baseline = loadSyncState(workspacePath);
  const snap = await snapshotPath(workspacePath, client, relPath, baseline);
  const { local, remote, version } = snap;
  if (local === 'same' || remote === 'same' || (local === 'deleted' && remote === 'deleted')) return null;

  const abs = path.join(workspacePath, ...relPath.split('/'));
  const [localData, remoteData] = await Promise.all([
    version.localMtimeMs !== null ? fs.promises.readFile(abs) : Promise.resolve(null),
    version.remoteEtag !== null ? (client.getFileContents(toRemotePath(relPath)) as Promise<Buffer>) : Promise.resolve(null),
  ]);

  if (local === 'created' && remote === 'created' && localData && remoteData && localData.equals(remoteData)) {
    baseline[relPath] = { localMtimeMs: version.localMtimeMs!, remoteEtag: version.remoteEtag! };
    writeBaseSnapshot(workspacePath, relPath, localData);
    saveSyncState(workspacePath, baseline);
    return null;
  }

  const isText = isTextPath(relPath);
  // A snapshot only counts if the baseline still exists alongside it — a
  // `created`/`created` file has no baseline, so any stray snapshot for it
  // is from some earlier, unrelated sync of that path.
  const base = isText && baseline[relPath] ? readBaseSnapshot(workspacePath, relPath) : null;
  const localText = isText && localData ? localData.toString('utf8') : null;
  const remoteText = isText && remoteData ? remoteData.toString('utf8') : null;

  const detail: WebDavConflictDetail = {
    path: relPath,
    local,
    remote,
    isText,
    hasBase: base !== null,
    localSize: localData?.length ?? null,
    remoteSize: remoteData?.length ?? snap.remoteSize,
    localChanges: null,
    remoteChanges: null,
    differences: null,
    merge: null,
    version,
  };
  if (!isText) return detail;

  if (base !== null) {
    if (localText !== null) detail.localChanges = diffHunks(base, localText);
    if (remoteText !== null) detail.remoteChanges = diffHunks(base, remoteText);
  } else if (localText !== null && remoteText !== null) {
    detail.differences = diffHunks(remoteText, localText);
  }
  if (localText !== null && remoteText !== null) {
    detail.merge = base !== null ? merge3(base, localText, remoteText) : merge2(localText, remoteText);
  }
  return detail;
}

/** Applies one resolution to both sides and records a fresh baseline (and
 * base snapshot) for the file. `expected` is the `version` from the
 * `getConflict` the user was looking at — if either side changed since,
 * nothing is touched and `{ok: false, reason: 'changed'}` comes back, so
 * the caller can re-read and show the newer content instead. */
export async function resolveConflict(
  workspacePath: string,
  config: WebDavConfig,
  relPath: string,
  resolution: WebDavResolution,
  expected: WebDavFileVersion
): Promise<WebDavResolveResult> {
  const client = createWebDavClient(config);
  const baseline = loadSyncState(workspacePath);
  const { version } = await snapshotPath(workspacePath, client, relPath, baseline);
  if (version.localMtimeMs !== expected.localMtimeMs || version.remoteEtag !== expected.remoteEtag) {
    return { ok: false, reason: 'changed', message: 'This file changed again since the conflict was opened — reopen it to see the latest versions.' };
  }

  const abs = path.join(workspacePath, ...relPath.split('/'));
  const remotePath = toRemotePath(relPath);

  async function upload(data: Buffer, localMtimeMs: number): Promise<void> {
    await ensureRemoteDir(client, path.posix.dirname(relPath));
    await client.putFileContents(remotePath, data, { overwrite: true });
    const stat = (await client.stat(remotePath)) as FileStat;
    baseline[relPath] = { localMtimeMs, remoteEtag: etagOf(stat) };
    writeBaseSnapshot(workspacePath, relPath, data);
  }

  function forget(): void {
    delete baseline[relPath];
    removeBaseSnapshot(workspacePath, relPath);
  }

  let localChanged = false;
  if (resolution.choice === 'local') {
    if (version.localMtimeMs !== null) {
      await upload(fs.readFileSync(abs), version.localMtimeMs);
    } else {
      if (version.remoteEtag !== null) await client.deleteFile(remotePath);
      forget();
    }
  } else if (resolution.choice === 'remote') {
    localChanged = true;
    if (version.remoteEtag !== null) {
      const data = (await client.getFileContents(remotePath)) as Buffer;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, data);
      baseline[relPath] = { localMtimeMs: fs.statSync(abs).mtimeMs, remoteEtag: version.remoteEtag };
      writeBaseSnapshot(workspacePath, relPath, data);
    } else {
      fs.rmSync(abs, { force: true });
      forget();
    }
  } else {
    if (!isTextPath(relPath) || version.localMtimeMs === null || version.remoteEtag === null) {
      return { ok: false, reason: 'invalid', message: 'A merged version can only be saved for a text file that exists on both sides.' };
    }
    localChanged = true;
    const data = Buffer.from(resolution.content, 'utf8');
    fs.writeFileSync(abs, data);
    await upload(data, fs.statSync(abs).mtimeMs);
  }

  saveSyncState(workspacePath, baseline);
  return { ok: true, localChanged };
}
