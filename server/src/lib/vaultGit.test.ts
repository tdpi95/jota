import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ensureGitRepo } from './workspaces.js';
import { commitChange, ensureGitHistory, getDiff, getHeadCommit, getHistory, isGitAvailable, revertCommit } from './vaultGit.js';

// Mirrors PLAN.md milestone 5's verify step: make a few changes through the
// helper directly, confirm `git log` shows one commit per change with the
// expected message format; revert one commit, confirm file content and
// `git log` both reflect the undo.

function scratchRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jota-vaultgit-'));
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  ensureGitRepo(dir);
  return dir;
}

test('commitChange stages and commits with the "[origin] message" format', () => {
  const dir = scratchRepo();
  fs.writeFileSync(path.join(dir, 'projects', 'a.md'), '# a\n', 'utf8');

  commitChange(dir, { origin: 'api', message: 'create_project a', paths: ['projects/a.md'] });

  const history = getHistory(dir);
  assert.equal(history.length, 1);
  assert.equal(history[0].message, '[api] create_project a');
  assert.match(history[0].hash, /^[0-9a-f]{40}$/);
});

test('commitChange is a no-op when nothing is staged', () => {
  const dir = scratchRepo();
  commitChange(dir, { origin: 'api', message: 'noop', paths: [] });
  assert.deepEqual(getHistory(dir), []);
});

test('getHistory scopes to one path and can be limited', () => {
  const dir = scratchRepo();
  fs.writeFileSync(path.join(dir, 'projects', 'a.md'), '1', 'utf8');
  commitChange(dir, { origin: 'api', message: 'create a', paths: ['projects/a.md'] });
  fs.writeFileSync(path.join(dir, 'projects', 'b.md'), '1', 'utf8');
  commitChange(dir, { origin: 'api', message: 'create b', paths: ['projects/b.md'] });

  assert.equal(getHistory(dir).length, 2);

  const onlyA = getHistory(dir, { path: 'projects/a.md' });
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0].message, '[api] create a');

  const limited = getHistory(dir, { limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].message, '[api] create b'); // most recent first
});

test('getDiff returns the patch introduced by a commit', () => {
  const dir = scratchRepo();
  fs.writeFileSync(path.join(dir, 'projects', 'a.md'), 'hello\n', 'utf8');
  commitChange(dir, { origin: 'api', message: 'create a', paths: ['projects/a.md'] });

  const [commit] = getHistory(dir);
  const diff = getDiff(dir, commit.hash);
  assert.match(diff, /\+hello/);
});

test('getDiff throws a readable error for an unknown commit', () => {
  const dir = scratchRepo();
  assert.throws(() => getDiff(dir, 'deadbeef'));
});

test('revertCommit undoes a change, restores file content, and records a new commit', () => {
  const dir = scratchRepo();
  const file = path.join(dir, 'projects', 'a.md');
  fs.writeFileSync(file, 'v1\n', 'utf8');
  commitChange(dir, { origin: 'api', message: 'create a', paths: ['projects/a.md'] });

  fs.writeFileSync(file, 'v2\n', 'utf8');
  commitChange(dir, { origin: 'api', message: 'update a', paths: ['projects/a.md'] });

  const [mostRecent] = getHistory(dir);
  const revertResult = revertCommit(dir, mostRecent.hash);

  assert.equal(fs.readFileSync(file, 'utf8'), 'v1\n');
  const after = getHistory(dir);
  assert.equal(after.length, 3);
  assert.equal(after[0].hash, revertResult.hash);
  assert.match(after[0].message, /^Revert /);
});

test('revertCommit throws with git\'s own error on an unknown commit', () => {
  const dir = scratchRepo();
  commitChange(dir, { origin: 'api', message: 'seed', paths: [] });
  assert.throws(() => revertCommit(dir, 'deadbeef'), /git revert failed/);
});

test('isGitAvailable is true when the git CLI is on PATH, false when it is not', () => {
  assert.equal(isGitAvailable(), true); // every environment these tests run in has git installed

  const originalPath = process.env.PATH;
  try {
    process.env.PATH = ''; // no directories to find a `git` binary in
    assert.equal(isGitAvailable(), false);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('getHeadCommit returns null for a repo with no commits, then the current HEAD hash after one', () => {
  const dir = scratchRepo();
  assert.equal(getHeadCommit(dir), null);

  fs.writeFileSync(path.join(dir, 'projects', 'a.md'), '1', 'utf8');
  commitChange(dir, { origin: 'api', message: 'create a', paths: ['projects/a.md'] });
  assert.equal(getHeadCommit(dir), getHistory(dir)[0].hash);

  fs.writeFileSync(path.join(dir, 'projects', 'b.md'), '1', 'utf8');
  commitChange(dir, { origin: 'mcp:create_task', message: 'create b', paths: ['projects/b.md'] });
  assert.equal(getHeadCommit(dir), getHistory(dir)[0].hash); // moves with each new commit
});

test('ensureGitHistory makes exactly one initial commit of pre-existing content, idempotently', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jota-vaultgit-'));
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', 'seed.md'), '# seed\n', 'utf8');

  ensureGitHistory(dir);
  const history = getHistory(dir);
  assert.equal(history.length, 1);
  assert.equal(history[0].message, '[system] initial commit');

  ensureGitHistory(dir); // calling again must not add a second initial commit
  assert.equal(getHistory(dir).length, 1);
});

test('ensureGitHistory does not commit .jota/ once it is gitignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jota-vaultgit-'));
  fs.mkdirSync(path.join(dir, '.jota', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitignore'), '.jota/\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.jota', 'cache', 'index.sqlite3'), 'binary-ish', 'utf8');

  ensureGitHistory(dir);
  const diff = getDiff(dir, getHistory(dir)[0].hash);
  assert.doesNotMatch(diff, /index\.sqlite3/);
});
