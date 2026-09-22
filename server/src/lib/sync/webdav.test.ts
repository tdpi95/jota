import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { v2 as webdavServer } from 'webdav-server';

import { pull, push, status, type WebDavConfig } from './webdav.js';

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
  remoteRoot = scratchDir('poco-webdav-remote-');
  const userManager = new webdavServer.SimpleUserManager();
  const user = userManager.addUser('alice', 'secret', false);
  const privilegeManager = new webdavServer.SimplePathPrivilegeManager();
  privilegeManager.setRights(user, '/', ['all']);

  davServer = new webdavServer.WebDAVServer({
    httpAuthentication: new webdavServer.HTTPBasicAuthentication(userManager, 'poco-test'),
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

function seededWorkspace(): string {
  const dir = scratchDir('poco-webdav-local-');
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
  fs.mkdirSync(path.join(a, '.poco', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(a, '.poco', 'cache', 'index.sqlite3'), 'derived cache', 'utf8');
  fs.writeFileSync(path.join(a, 'projects', 'real.md'), 'real content\n', 'utf8');

  const result = await push(a, config);
  assert.deepEqual(result, { synced: ['projects/real.md'], conflicts: [] });
  assert.equal(fs.existsSync(path.join(remoteRoot, '.git')), false);
  assert.equal(fs.existsSync(path.join(remoteRoot, '.poco')), false);
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
