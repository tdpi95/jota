import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { v2 as webdavServer } from 'webdav-server';

import {
  getConflict,
  isValidSyncPath,
  pull,
  push,
  resetSyncState,
  resolveConflict,
  status,
  testConnection,
  type WebDavConfig,
} from './webdav.js';

// Mirrors gitRemote.test.ts's convention: a real server, not a mock — here a
// real in-process WebDAV server (webdav-server) rather than a real bare git
// repo, since this provider has no git dependency to exercise instead.

function scratchDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

let httpServer: Server;
let davServer: InstanceType<typeof webdavServer.WebDAVServer>;
let remoteRoot: string;
let config: WebDavConfig;

before(async () => {
  remoteRoot = scratchDir('jota-webdav-remote-');
  const userManager = new webdavServer.SimpleUserManager();
  const user = userManager.addUser('alice', 'secret', false);
  const privilegeManager = new webdavServer.SimplePathPrivilegeManager();
  privilegeManager.setRights(user, '/', ['all']);

  davServer = new webdavServer.WebDAVServer({
    httpAuthentication: new webdavServer.HTTPBasicAuthentication(userManager, 'jota-test'),
    privilegeManager,
    rootFileSystem: new webdavServer.PhysicalFileSystem(remoteRoot),
  });

  httpServer = await new Promise<Server>((resolve) => davServer.start(0, (server) => resolve(server!)));
  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  config = { url: `http://127.0.0.1:${port}`, username: 'alice', password: 'secret' };
});

after(async () => {
  await davServer.stopAsync();
});

// Each test gets a fresh local workspace *and* a fresh remote root, so
// baseline state never leaks between tests despite sharing one running
// server process.
beforeEach(() => {
  fs.rmSync(remoteRoot, { recursive: true, force: true });
  fs.mkdirSync(remoteRoot, { recursive: true });
});

/** Just the count/conflict fields of a status — for tests about *whether*
 * something needs syncing, not which files (the file-list test covers that). */
function counts(s: { toPush: number; toPull: number; conflicts: string[] }) {
  return { toPush: s.toPush, toPull: s.toPull, conflicts: s.conflicts };
}

function seededWorkspace(): string {
  const dir = scratchDir('jota-webdav-local-');
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  return dir;
}

test('push uploads a new local file and records a baseline', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'hello\n', 'utf8');

  const result = await push(a, config);
  assert.deepEqual(result, { synced: ['projects/x.md'], conflicts: [] });
  assert.equal(fs.readFileSync(path.join(remoteRoot, 'projects', 'x.md'), 'utf8'), 'hello\n');

  // a clean second push is a no-op — nothing changed since the baseline
  const second = await push(a, config);
  assert.deepEqual(second, { synced: [], conflicts: [] });
});

test('pull downloads a file that exists only on the remote', async () => {
  const a = seededWorkspace();
  fs.mkdirSync(path.join(remoteRoot, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(remoteRoot, 'notes', 'y.md'), 'from remote\n', 'utf8');

  const result = await pull(a, config);
  assert.deepEqual(result, { synced: ['notes/y.md'], conflicts: [] });
  assert.equal(fs.readFileSync(path.join(a, 'notes', 'y.md'), 'utf8'), 'from remote\n');
});

test('push then pull round-trips a file to a second workspace unchanged', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'shared.md'), 'v1\n', 'utf8');
  await push(a, config);

  const b = seededWorkspace();
  const result = await pull(b, config);
  assert.deepEqual(result, { synced: ['projects/shared.md'], conflicts: [] });
  assert.equal(fs.readFileSync(path.join(b, 'projects', 'shared.md'), 'utf8'), 'v1\n');
});

test('a file changed on both sides since the baseline is left untouched and reported as a conflict', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'shared.md'), 'v1\n', 'utf8');
  await push(a, config);

  const b = seededWorkspace();
  await pull(b, config);

  // Diverge: A edits locally, B's local copy is edited independently too,
  // without either side syncing again first.
  fs.writeFileSync(path.join(a, 'projects', 'shared.md'), 'from A\n', 'utf8');
  await push(a, config); // remote now has A's edit

  fs.writeFileSync(path.join(b, 'projects', 'shared.md'), 'from B\n', 'utf8');
  const result = await push(b, config);

  assert.deepEqual(result, { synced: [], conflicts: ['projects/shared.md'] });
  // B's own file must be untouched — never silently overwritten.
  assert.equal(fs.readFileSync(path.join(b, 'projects', 'shared.md'), 'utf8'), 'from B\n');
  // The remote must still hold A's edit — never silently overwritten either.
  assert.equal(fs.readFileSync(path.join(remoteRoot, 'projects', 'shared.md'), 'utf8'), 'from A\n');
});

test('deleting a file locally deletes it on the remote on push', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'gone.md'), 'bye\n', 'utf8');
  await push(a, config);
  assert.equal(fs.existsSync(path.join(remoteRoot, 'projects', 'gone.md')), true);

  fs.rmSync(path.join(a, 'projects', 'gone.md'));
  const result = await push(a, config);
  assert.deepEqual(result, { synced: ['projects/gone.md'], conflicts: [] });
  assert.equal(fs.existsSync(path.join(remoteRoot, 'projects', 'gone.md')), false);
});

test('a file deleted independently on both sides is a clean no-op, not a conflict', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'both-delete.md'), 'x\n', 'utf8');
  await push(a, config);

  const b = seededWorkspace();
  await pull(b, config);

  fs.rmSync(path.join(a, 'projects', 'both-delete.md'));
  await push(a, config); // remote copy now gone too

  fs.rmSync(path.join(b, 'projects', 'both-delete.md'));
  const result = await push(b, config);
  assert.deepEqual(result, { synced: [], conflicts: [] });
});

test('.git and dotfiles are never synced', async () => {
  const a = seededWorkspace();
  fs.mkdirSync(path.join(a, '.git', 'objects'), { recursive: true });
  fs.writeFileSync(path.join(a, '.git', 'objects', 'deadbeef'), 'not vault content', 'utf8');
  fs.mkdirSync(path.join(a, '.jota', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(a, '.jota', 'cache', 'index.sqlite3'), 'derived cache', 'utf8');
  fs.writeFileSync(path.join(a, 'projects', 'real.md'), 'real content\n', 'utf8');

  const result = await push(a, config);
  assert.deepEqual(result, { synced: ['projects/real.md'], conflicts: [] });
  assert.equal(fs.existsSync(path.join(remoteRoot, '.git')), false);
  assert.equal(fs.existsSync(path.join(remoteRoot, '.jota')), false);
});

test('status reports counts without transferring anything', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'p.md'), 'p\n', 'utf8');

  const before1 = await status(a, config, null);
  assert.equal(before1.toPush, 1);
  assert.equal(before1.toPull, 0);
  assert.deepEqual(before1.conflicts, []);
  assert.equal(before1.lastSyncedAt, null);
  // status must not have uploaded anything itself
  assert.equal(fs.existsSync(path.join(remoteRoot, 'projects', 'p.md')), false);

  await push(a, config);
  const after1 = await status(a, config, '2026-09-22T00:00:00.000Z');
  assert.equal(after1.toPush, 0);
  assert.equal(after1.toPull, 0);
  assert.equal(after1.lastSyncedAt, '2026-09-22T00:00:00.000Z');

  fs.mkdirSync(path.join(remoteRoot, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(remoteRoot, 'notes', 'q.md'), 'q\n', 'utf8');
  const after2 = await status(a, config, null);
  assert.equal(after2.toPush, 0);
  assert.equal(after2.toPull, 1);
});

test('testConnection succeeds against a reachable, authenticated server', async () => {
  assert.deepEqual(await testConnection(config), { ok: true });
});

test('testConnection reports an auth failure distinctly from other errors', async () => {
  const result = await testConnection({ ...config, password: 'wrong' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'auth');
});

test('testConnection reports a not-found folder distinctly from an auth failure', async () => {
  const result = await testConnection({ ...config, url: `${config.url}/does-not-exist-yet` });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'not-found');
});

// Real bug found in live use: changing the WebDAV URL (e.g. to a different
// subfolder) without resetting the baseline made `status`/`pull` treat
// every already-synced local file as if the *remote* had deleted it — since
// the baseline still says it was synced, and it's missing on the new
// target. Left unfixed, clicking Pull in that state would delete every
// local file that simply isn't on the new remote yet.
test('changing the WebDAV URL to a different, empty target does not misreport local files as "to pull"', async () => {
  const a = seededWorkspace();
  fs.mkdirSync(path.join(remoteRoot, 'vault-a'), { recursive: true });
  fs.mkdirSync(path.join(remoteRoot, 'vault-b'), { recursive: true });
  const configA: WebDavConfig = { ...config, url: `${config.url}/vault-a` };
  const configB: WebDavConfig = { ...config, url: `${config.url}/vault-b` };

  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'hello\n', 'utf8');
  await push(a, configA); // baseline now recorded against vault-a

  // Without resetting the baseline first, status against the new (empty)
  // vault-b reproduces the bug: the file reads as "remote deleted it".
  const buggyStatus = await status(a, configB, null);
  assert.equal(buggyStatus.toPull, 1);
  assert.equal(buggyStatus.toPush, 0);

  // The fix: resetting the baseline (what services/webdavSync.ts's
  // setConfig now does whenever the URL actually changes) makes every
  // local file correctly read as new-to-upload against the new target.
  resetSyncState(a);
  const fixedStatus = await status(a, configB, null);
  assert.equal(fixedStatus.toPush, 1);
  assert.equal(fixedStatus.toPull, 0);

  const pushResult = await push(a, configB);
  assert.deepEqual(pushResult, { synced: ['projects/x.md'], conflicts: [] });
  assert.equal(fs.existsSync(path.join(remoteRoot, 'vault-b', 'projects', 'x.md')), true);
});

// A second real bug found immediately after fixing the first one, in the
// exact same live session: switching *back* to the original (already-
// synced) URL after the reset above wiped the baseline to nothing for that
// target too — and the old code treated "no baseline, present on both
// sides" as an unconditional conflict, regardless of whether the content
// actually matched. Every unchanged file reported as conflicting with
// itself the moment the user reconnected to the vault they'd already
// pushed everything to.
test('switching back to a previously-synced URL with unchanged content reports no conflicts, not a false conflict wall', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'hello\n', 'utf8');
  fs.writeFileSync(path.join(a, 'projects', 'y.md'), 'world\n', 'utf8');
  await push(a, config); // baseline recorded against `config`'s remote

  // Simulate switching to a different (empty) target and back, resetting
  // the baseline in between — exactly what services/webdavSync.ts's
  // setConfig does on each real URL change.
  resetSyncState(a);

  const reconnectedStatus = await status(a, config, null);
  assert.equal(reconnectedStatus.toPush, 0);
  assert.equal(reconnectedStatus.toPull, 0);
  assert.deepEqual(reconnectedStatus.conflicts, []);

  // A push after reconnecting should be a clean no-op too — nothing to
  // upload, nothing flagged, and the baseline is filled back in for both
  // files by the content-compare (not by re-uploading them).
  const pushResult = await push(a, config);
  assert.deepEqual(pushResult, { synced: [], conflicts: [] });
});

test('the content-compare does not mask a genuine conflict — differing content with no baseline still reports as a conflict', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'local version\n', 'utf8');
  await push(a, config);

  // A different local workspace, connecting to the same already-populated
  // remote for the first time, with a file of the same name but genuinely
  // different content.
  const b = seededWorkspace();
  fs.writeFileSync(path.join(b, 'projects', 'x.md'), 'a completely different version\n', 'utf8');

  const conflictStatus = await status(b, config, null);
  assert.deepEqual(conflictStatus.conflicts, ['projects/x.md']);

  const pushResult = await push(b, config);
  assert.deepEqual(pushResult, { synced: [], conflicts: ['projects/x.md'] });
  // Neither side was overwritten.
  assert.equal(fs.readFileSync(path.join(b, 'projects', 'x.md'), 'utf8'), 'a completely different version\n');
  assert.equal(fs.readFileSync(path.join(remoteRoot, 'projects', 'x.md'), 'utf8'), 'local version\n');
});

// A real live-use report ("still don't update immediately after changing
// url") traced back to computeDiff's ambiguous-file content-compare running
// one file at a time — for a vault of any real size, reconnecting to an
// already-populated matching remote meant one sequential fetch-and-compare
// per file. This proves the concurrent version handles a batch larger than
// WEBDAV_CONCURRENCY correctly: every file resolved, none dropped or
// double-counted by the worker pool, and the baseline fully backfilled so
// a second call doesn't redo any of it.
test('a large batch of ambiguous (no-baseline) matching files all resolve correctly with no conflicts', async () => {
  const a = seededWorkspace();
  const fileCount = 30; // > WEBDAV_CONCURRENCY, to exercise the worker pool across multiple rounds
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(path.join(a, 'projects', `f${i}.md`), `content ${i}\n`, 'utf8');
  }
  await push(a, config);

  resetSyncState(a); // simulate reconnecting with no baseline, matching remote content

  const reconnectedStatus = await status(a, config, null);
  assert.equal(reconnectedStatus.toPush, 0);
  assert.equal(reconnectedStatus.toPull, 0);
  assert.deepEqual(reconnectedStatus.conflicts, []);

  // The baseline should now be fully backfilled — a second status call
  // does no further work (no ambiguity left to resolve).
  const secondStatus = await status(a, config, null);
  assert.equal(secondStatus.toPush, 0);
  assert.equal(secondStatus.toPull, 0);
  assert.deepEqual(secondStatus.conflicts, []);
});

// A second, distinct part of the same performance report: even with
// nothing ambiguous to resolve, listRemoteFiles walked one directory at a
// time — against a real server's per-request latency (not an in-process
// test server's near-zero latency), that alone was the dominant cost of
// every single status/push/pull call, independent of the content-compare
// fix above. This proves a vault with more sibling directories than
// WEBDAV_CONCURRENCY still finds every file across all of them correctly
// with the concurrent walk.
test('remote file listing correctly walks many sibling directories, more than WEBDAV_CONCURRENCY', async () => {
  const a = seededWorkspace();
  const dirCount = 15; // > WEBDAV_CONCURRENCY
  for (let i = 0; i < dirCount; i++) {
    fs.mkdirSync(path.join(a, `dir${i}`), { recursive: true });
    fs.writeFileSync(path.join(a, `dir${i}`, 'f.md'), `content ${i}\n`, 'utf8');
  }

  const result = await push(a, config);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.synced.length, dirCount); // seededWorkspace's own `projects/` dir is empty, contributes no files
  for (let i = 0; i < dirCount; i++) {
    assert.equal(fs.existsSync(path.join(remoteRoot, `dir${i}`, 'f.md')), true);
  }

  const b = seededWorkspace();
  const pullResult = await pull(b, config);
  assert.equal(pullResult.conflicts.length, 0);
  for (let i = 0; i < dirCount; i++) {
    assert.equal(fs.readFileSync(path.join(b, `dir${i}`, 'f.md'), 'utf8'), `content ${i}\n`);
  }
});

// --- conflict detail + resolution ---------------------------------------

/** A pushes `base`, B pulls it, then A edits (and pushes) `remoteEdit`
 * while B edits `localEdit` locally — leaving B with one real conflict. */
async function divergedPair(base: string, remoteEdit: string | null, localEdit: string | null): Promise<{ a: string; b: string }> {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'shared.md'), base, 'utf8');
  await push(a, config);
  const b = seededWorkspace();
  await pull(b, config);

  if (remoteEdit === null) fs.rmSync(path.join(a, 'projects', 'shared.md'));
  else fs.writeFileSync(path.join(a, 'projects', 'shared.md'), remoteEdit, 'utf8');
  await push(a, config);

  if (localEdit === null) fs.rmSync(path.join(b, 'projects', 'shared.md'));
  else fs.writeFileSync(path.join(b, 'projects', 'shared.md'), localEdit, 'utf8');
  assert.deepEqual((await status(b, config, null)).conflicts, ['projects/shared.md']);
  return { a, b };
}

const readLocal = (ws: string) => fs.readFileSync(path.join(ws, 'projects', 'shared.md'), 'utf8');
const readRemote = () => fs.readFileSync(path.join(remoteRoot, 'projects', 'shared.md'), 'utf8');

test('getConflict shows each side\'s own changes against the last-synced copy, pre-merging non-overlapping edits', async () => {
  const { b } = await divergedPair('a\nb\nc\nd\n', 'A\nb\nc\nd\n', 'a\nb\nc\nD\n');
  const detail = await getConflict(b, config, 'projects/shared.md');
  assert.ok(detail);
  assert.equal(detail.local, 'modified');
  assert.equal(detail.remote, 'modified');
  assert.equal(detail.hasBase, true);
  assert.deepEqual(
    detail.localChanges!.flatMap((h) => h.lines.filter((l) => l.type !== ' ')),
    [{ type: '-', text: 'd' }, { type: '+', text: 'D' }]
  );
  assert.deepEqual(
    detail.remoteChanges!.flatMap((h) => h.lines.filter((l) => l.type !== ' ')),
    [{ type: '-', text: 'a' }, { type: '+', text: 'A' }]
  );
  assert.deepEqual(detail.merge, [{ kind: 'ok', lines: ['A', 'b', 'c', 'D', ''] }]);
  assert.equal(detail.differences, null);
});

test('overlapping edits come back as a conflict chunk carrying base, local, and remote', async () => {
  const { b } = await divergedPair('a\nb\nc\n', 'a\nfrom A\nc\n', 'a\nfrom B\nc\n');
  const detail = await getConflict(b, config, 'projects/shared.md');
  assert.deepEqual(detail!.merge, [
    { kind: 'ok', lines: ['a'] },
    { kind: 'conflict', local: ['from B'], remote: ['from A'], base: ['b'] },
    { kind: 'ok', lines: ['c', ''] },
  ]);
});

test('resolving with a merged version writes it to both sides and clears the conflict', async () => {
  const { a, b } = await divergedPair('a\nb\n', 'A\nb\n', 'a\nB\n');
  const detail = (await getConflict(b, config, 'projects/shared.md'))!;
  const result = await resolveConflict(b, config, 'projects/shared.md', { choice: 'merged', content: 'A\nB\n' }, detail.version);
  assert.deepEqual(result, { ok: true, localChanged: true });
  assert.equal(readLocal(b), 'A\nB\n');
  assert.equal(readRemote(), 'A\nB\n');

  const after = await status(b, config, null);
  assert.deepEqual(counts(after), { toPush: 0, toPull: 0, conflicts: [] });
  assert.equal(await getConflict(b, config, 'projects/shared.md'), null);
  // The other device just sees an ordinary remote change to pull.
  assert.deepEqual(await pull(a, config), { synced: ['projects/shared.md'], conflicts: [] });
  assert.equal(readLocal(a), 'A\nB\n');
});

test("keeping this device's version uploads it; keeping the server's downloads it", async () => {
  {
    const { b } = await divergedPair('v1\n', 'from A\n', 'from B\n');
    const detail = (await getConflict(b, config, 'projects/shared.md'))!;
    assert.deepEqual(await resolveConflict(b, config, 'projects/shared.md', { choice: 'local' }, detail.version), { ok: true, localChanged: false });
    assert.equal(readRemote(), 'from B\n');
    assert.deepEqual((await status(b, config, null)).conflicts, []);
  }
  fs.rmSync(remoteRoot, { recursive: true, force: true });
  fs.mkdirSync(remoteRoot, { recursive: true });
  {
    const { b } = await divergedPair('v1\n', 'from A\n', 'from B\n');
    const detail = (await getConflict(b, config, 'projects/shared.md'))!;
    assert.deepEqual(await resolveConflict(b, config, 'projects/shared.md', { choice: 'remote' }, detail.version), { ok: true, localChanged: true });
    assert.equal(readLocal(b), 'from A\n');
    assert.deepEqual(counts(await status(b, config, null)), { toPush: 0, toPull: 0, conflicts: [] });
  }
});

test('a resolution is refused, touching nothing, if either side changed since the conflict was read', async () => {
  const { b } = await divergedPair('v1\n', 'from A\n', 'from B\n');
  const detail = (await getConflict(b, config, 'projects/shared.md'))!;
  fs.writeFileSync(path.join(remoteRoot, 'projects', 'shared.md'), 'from A, again\n', 'utf8');

  const result = await resolveConflict(b, config, 'projects/shared.md', { choice: 'local' }, detail.version);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'changed');
  assert.equal(readRemote(), 'from A, again\n');
  assert.equal(readLocal(b), 'from B\n');
});

test('a delete-vs-edit conflict can be resolved either way', async () => {
  const { b } = await divergedPair('v1\n', null, 'edited\n');
  const detail = (await getConflict(b, config, 'projects/shared.md'))!;
  assert.equal(detail.local, 'modified');
  assert.equal(detail.remote, 'deleted');
  assert.equal(detail.merge, null);
  assert.ok(detail.localChanges);
  assert.equal(detail.remoteChanges, null);

  // Keeping the server's side here means accepting the deletion.
  assert.deepEqual(await resolveConflict(b, config, 'projects/shared.md', { choice: 'remote' }, detail.version), { ok: true, localChanged: true });
  assert.equal(fs.existsSync(path.join(b, 'projects', 'shared.md')), false);
  assert.deepEqual((await status(b, config, null)).conflicts, []);
});

test('a never-synced file with different content on both sides gets a two-way diff', async () => {
  const b = seededWorkspace();
  fs.mkdirSync(path.join(remoteRoot, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(remoteRoot, 'projects', 'shared.md'), 'same\nremote line\n', 'utf8');
  fs.writeFileSync(path.join(b, 'projects', 'shared.md'), 'same\nlocal line\n', 'utf8');

  const detail = (await getConflict(b, config, 'projects/shared.md'))!;
  assert.equal(detail.local, 'created');
  assert.equal(detail.remote, 'created');
  assert.equal(detail.hasBase, false);
  assert.equal(detail.localChanges, null);
  assert.ok(detail.differences && detail.differences.length === 1);
  assert.deepEqual(detail.merge, [
    { kind: 'ok', lines: ['same'] },
    { kind: 'conflict', local: ['local line'], remote: ['remote line'], base: null },
    { kind: 'ok', lines: [''] },
  ]);
});

test('files synced before base snapshots existed get one backfilled while unchanged', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'shared.md'), 'v1\n', 'utf8');
  await push(a, config);
  const snapshot = path.join(a, '.jota', 'cache', 'webdav-base', 'projects', 'shared.md');
  assert.equal(fs.readFileSync(snapshot, 'utf8'), 'v1\n');

  fs.rmSync(path.join(a, '.jota', 'cache', 'webdav-base'), { recursive: true });
  await status(a, config, null);
  assert.equal(fs.readFileSync(snapshot, 'utf8'), 'v1\n');
});

test('getConflict returns null for a file that is not in conflict, and only valid sync paths are accepted', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'hi\n', 'utf8');
  await push(a, config);
  assert.equal(await getConflict(a, config, 'projects/x.md'), null);

  assert.equal(isValidSyncPath('projects/x.md'), true);
  for (const bad of ['', '/projects/x.md', '../x.md', 'projects/../../x.md', '.git/config', '.jota/cache/index.sqlite3', 'projects\\x.md']) {
    assert.equal(isValidSyncPath(bad), false, bad);
  }
});

// --- false conflicts: "the server only has an older copy of ours" -----------

function gitCommitAll(ws: string, message: string): void {
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd: ws, stdio: 'ignore' });
  if (!fs.existsSync(path.join(ws, '.git'))) git('init', '-q');
  fs.writeFileSync(path.join(ws, '.gitignore'), '.jota/\n', 'utf8');
  git('add', '-A');
  git('commit', '-q', '-m', message);
}

test('with the baseline lost, a server copy that is an older committed version of ours is a plain push, not a conflict', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'v1\n', 'utf8');
  gitCommitAll(a, 'v1');
  await push(a, config);

  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'v1\nv2 local edit\n', 'utf8');
  gitCommitAll(a, 'v2');
  resetSyncState(a); // what the Poco→Jota cache-folder rename effectively did

  assert.deepEqual(counts(await status(a, config, null)), { toPush: 1, toPull: 0, conflicts: [] });
  assert.deepEqual(await push(a, config), { synced: ['projects/x.md'], conflicts: [] });
  assert.equal(fs.readFileSync(path.join(remoteRoot, 'projects', 'x.md'), 'utf8'), 'v1\nv2 local edit\n');
});

test('with the baseline lost, a server copy this device never had is still a conflict', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'v1\n', 'utf8');
  gitCommitAll(a, 'v1');
  await push(a, config);
  fs.writeFileSync(path.join(remoteRoot, 'projects', 'x.md'), 'edited on another device\n', 'utf8');
  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'edited here\n', 'utf8');
  gitCommitAll(a, 'local edit');
  resetSyncState(a);

  assert.deepEqual((await status(a, config, null)).conflicts, ['projects/x.md']);
  assert.deepEqual(await push(a, config), { synced: [], conflicts: ['projects/x.md'] });
  assert.equal(fs.readFileSync(path.join(remoteRoot, 'projects', 'x.md'), 'utf8'), 'edited on another device\n');
});

test('a server etag change with unchanged content does not make a local edit a conflict', async () => {
  const a = seededWorkspace(); // no git repo: this relies on the base snapshot alone
  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'v1\n', 'utf8');
  await push(a, config);

  // Same bytes rewritten on the server (a rescan/touch) — new etag, no new content.
  await new Promise((r) => setTimeout(r, 1100));
  fs.writeFileSync(path.join(remoteRoot, 'projects', 'x.md'), 'v1\n', 'utf8');
  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'v1\nlocal\n', 'utf8');

  assert.deepEqual(counts(await status(a, config, null)), { toPush: 1, toPull: 0, conflicts: [] });
  assert.deepEqual(await push(a, config), { synced: ['projects/x.md'], conflicts: [] });
});

test('a local mtime change with unchanged content lets a real server edit pull cleanly', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'v1\n', 'utf8');
  await push(a, config);

  fs.writeFileSync(path.join(remoteRoot, 'projects', 'x.md'), 'v2 from elsewhere\n', 'utf8');
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(path.join(a, 'projects', 'x.md'), 'v1\n', 'utf8'); // rewritten, identical

  assert.deepEqual(counts(await status(a, config, null)), { toPush: 0, toPull: 1, conflicts: [] });
  assert.deepEqual(await pull(a, config), { synced: ['projects/x.md'], conflicts: [] });
  assert.equal(fs.readFileSync(path.join(a, 'projects', 'x.md'), 'utf8'), 'v2 from elsewhere\n');
});

test('status lists exactly which files a push and a pull would act on, and how', async () => {
  const a = seededWorkspace();
  fs.writeFileSync(path.join(a, 'projects', 'kept.md'), 'v1\n', 'utf8');
  fs.writeFileSync(path.join(a, 'projects', 'edited.md'), 'v1\n', 'utf8');
  fs.writeFileSync(path.join(a, 'projects', 'removed.md'), 'v1\n', 'utf8');
  fs.writeFileSync(path.join(a, 'projects', 'remote-edit.md'), 'v1\n', 'utf8');
  await push(a, config);

  fs.writeFileSync(path.join(a, 'projects', 'edited.md'), 'v2\n', 'utf8');
  fs.writeFileSync(path.join(a, 'projects', 'new.md'), 'new\n', 'utf8');
  fs.rmSync(path.join(a, 'projects', 'removed.md'));
  fs.writeFileSync(path.join(remoteRoot, 'projects', 'remote-edit.md'), 'v2 elsewhere\n', 'utf8');
  fs.writeFileSync(path.join(remoteRoot, 'projects', 'remote-new.md'), 'hi\n', 'utf8');

  const s = await status(a, config, null);
  assert.deepEqual(s.pushFiles, [
    { path: 'projects/edited.md', change: 'modified' },
    { path: 'projects/new.md', change: 'added' },
    { path: 'projects/removed.md', change: 'deleted' },
  ]);
  assert.deepEqual(s.pullFiles, [
    { path: 'projects/remote-edit.md', change: 'modified' },
    { path: 'projects/remote-new.md', change: 'added' },
  ]);
  assert.equal(s.toPush, 3);
  assert.equal(s.toPull, 2);

  // The lists are what the operations actually do.
  assert.deepEqual((await push(a, config)).synced.sort(), s.pushFiles.map((f) => f.path));
  assert.deepEqual((await pull(a, config)).synced.sort(), s.pullFiles.map((f) => f.path));
});
