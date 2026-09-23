import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { commitChange } from '../vaultGit.js';
import { ensureGitRepo } from '../workspaces.js';
import { getRemote, pull, push, setRemote, status } from './gitRemote.js';

// Mirrors PLAN.md milestone 6's verify step: point a scratch workspace at a
// local bare git repo as `origin`, push, pull, confirm state matches;
// simulate a conflicting change on both sides and confirm pull returns a
// structured conflict list rather than corrupting files.

function scratchDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function bareRemote(): string {
  const dir = scratchDir('poco-bare-');
  execFileSync('git', ['init', '--bare'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

function seededWorkspace(): string {
  const dir = scratchDir('poco-sync-');
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  ensureGitRepo(dir);
  fs.writeFileSync(path.join(dir, 'projects', 'a.md'), 'line one\n', 'utf8');
  commitChange(dir, { origin: 'api', message: 'seed', paths: ['projects/a.md'] });
  return dir;
}

function cloneWorkspace(remote: string): string {
  const dir = scratchDir('poco-sync-clone-');
  // -c core.autocrlf=false applies before clone's own initial checkout —
  // ensureGitRepo's identical override below only takes effect on repo
  // config from here on, too late to undo a CRLF conversion the clone's
  // checkout already made (matters on a machine whose global git config
  // defaults core.autocrlf=true, e.g. GitHub-hosted Windows runners, or a
  // typical Windows git installer default).
  execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', remote, dir], { stdio: 'ignore' });
  ensureGitRepo(dir); // sets a local identity if none resolves, needed for later merge commits
  return dir;
}

test('setRemote/getRemote round-trip and push publishes commits to the bare repo', () => {
  const remote = bareRemote();
  const a = seededWorkspace();

  assert.equal(getRemote(a), null);
  setRemote(a, remote);
  assert.equal(getRemote(a), remote);

  push(a);

  const b = cloneWorkspace(remote);
  assert.equal(fs.readFileSync(path.join(b, 'projects', 'a.md'), 'utf8'), 'line one\n');
});

test('pull fast-forwards a workspace onto changes pushed from elsewhere', () => {
  const remote = bareRemote();
  const a = seededWorkspace();
  setRemote(a, remote);
  push(a);
  const b = cloneWorkspace(remote);
  setRemote(b, remote);

  fs.writeFileSync(path.join(a, 'projects', 'a.md'), 'line one\nline two\n', 'utf8');
  commitChange(a, { origin: 'api', message: 'update', paths: ['projects/a.md'] });
  push(a);

  const result = pull(b);
  assert.deepEqual(result, { conflict: false });
  assert.equal(fs.readFileSync(path.join(b, 'projects', 'a.md'), 'utf8'), 'line one\nline two\n');
});

test('pull with no new remote history is a clean no-op', () => {
  const remote = bareRemote();
  const a = seededWorkspace();
  setRemote(a, remote);
  push(a);

  const result = pull(a);
  assert.deepEqual(result, { conflict: false });
});

test('pull surfaces a conflicting change as a structured conflict list, never corrupting the file', () => {
  const remote = bareRemote();
  const a = seededWorkspace();
  setRemote(a, remote);
  push(a);
  const b = cloneWorkspace(remote);
  setRemote(b, remote);

  // Diverge: A and B both edit the same line differently, A pushes first.
  fs.writeFileSync(path.join(a, 'projects', 'a.md'), 'line one, from A\n', 'utf8');
  commitChange(a, { origin: 'api', message: 'edit from A', paths: ['projects/a.md'] });
  push(a);

  fs.writeFileSync(path.join(b, 'projects', 'a.md'), 'line one, from B\n', 'utf8');
  commitChange(b, { origin: 'api', message: 'edit from B', paths: ['projects/a.md'] });

  const result = pull(b);
  assert.equal(result.conflict, true);
  if (result.conflict) assert.deepEqual(result.files, ['projects/a.md']);

  // The working tree must be exactly B's pre-pull content — no conflict
  // markers, no partial merge state left behind.
  assert.equal(fs.readFileSync(path.join(b, 'projects', 'a.md'), 'utf8'), 'line one, from B\n');
  // And the abort must have left the repo clean, not mid-merge.
  const statusOutput = execFileSync('git', ['status', '--porcelain'], { cwd: b, encoding: 'utf8' });
  assert.equal(statusOutput.trim(), '');
});

test('status reports remote url, dirty state, and ahead/behind counts', () => {
  const remote = bareRemote();
  const a = seededWorkspace();
  setRemote(a, remote);
  push(a);
  const b = cloneWorkspace(remote);
  setRemote(b, remote);

  fs.writeFileSync(path.join(a, 'projects', 'a.md'), 'line one\nline two\n', 'utf8');
  commitChange(a, { origin: 'api', message: 'update', paths: ['projects/a.md'] });
  push(a);

  const s = status(b, null);
  assert.equal(s.remoteUrl, remote);
  assert.equal(s.dirty, false);
  assert.equal(s.behind, 1);
  assert.equal(s.ahead, 0);
  assert.equal(s.lastSyncedAt, null);

  fs.writeFileSync(path.join(b, 'projects', 'untracked.md'), 'wip\n', 'utf8');
  const dirtyStatus = status(b, '2026-09-10T00:00:00.000Z');
  assert.equal(dirtyStatus.dirty, true);
  assert.equal(dirtyStatus.lastSyncedAt, '2026-09-10T00:00:00.000Z');
});

test('push throws a readable error when no remote is configured', () => {
  const a = seededWorkspace();
  assert.throws(() => push(a), /no remote configured/);
});
