import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { getHistory } from '../lib/vaultGit.js';
import { ensureGitRepo } from '../lib/workspaces.js';
import { isAttachmentFolder, saveAttachment } from './attachments.js';

// Mirrors this milestone's design: a plain file under
// `<workspace>/attachments/<folder>/`, committed to git like any other
// write, with no SQLite index row (attachments carry no queryable metadata).

function scratchWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jota-attachments-'));
  ensureGitRepo(dir);
  return dir;
}

test('isAttachmentFolder accepts only the four known folders', () => {
  assert.equal(isAttachmentFolder('tasks'), true);
  assert.equal(isAttachmentFolder('journal'), true);
  assert.equal(isAttachmentFolder('notes'), true);
  assert.equal(isAttachmentFolder('projects'), true);
  assert.equal(isAttachmentFolder('other'), false);
});

test('saveAttachment writes the file under attachments/<folder>/, indexes nothing, and commits', () => {
  const ws = scratchWorkspace();
  const attachment = saveAttachment(ws, 'notes', 'photo.png', Buffer.from('fake-png-bytes'));

  assert.equal(attachment.filename, 'photo.png');
  assert.equal(attachment.path, 'attachments/notes/photo.png');
  assert.equal(attachment.url, '/api/attachments/notes/photo.png');

  const onDisk = fs.readFileSync(path.join(ws, 'attachments', 'notes', 'photo.png'));
  assert.equal(onDisk.toString(), 'fake-png-bytes');
  assert.equal(getHistory(ws)[0].message, '[api] attach_file attachments/notes/photo.png');
});

test('saveAttachment auto-suffixes a colliding filename instead of overwriting', () => {
  const ws = scratchWorkspace();
  const first = saveAttachment(ws, 'journal', 'IMG_1.jpg', Buffer.from('one'));
  const second = saveAttachment(ws, 'journal', 'IMG_1.jpg', Buffer.from('two'));

  assert.equal(first.filename, 'IMG_1.jpg');
  assert.equal(second.filename, 'IMG_1-2.jpg');
  assert.equal(fs.readFileSync(path.join(ws, 'attachments', 'journal', 'IMG_1.jpg')).toString(), 'one');
  assert.equal(fs.readFileSync(path.join(ws, 'attachments', 'journal', 'IMG_1-2.jpg')).toString(), 'two');
});

test('saveAttachment strips directory components from the original filename (no path traversal)', () => {
  const ws = scratchWorkspace();
  const attachment = saveAttachment(ws, 'tasks', '../../etc/passwd', Buffer.from('x'));

  assert.equal(attachment.filename, 'passwd');
  assert.equal(attachment.path, 'attachments/tasks/passwd');
  assert.ok(fs.existsSync(path.join(ws, 'attachments', 'tasks', 'passwd')));
  assert.ok(!fs.existsSync(path.join(ws, '..', 'etc', 'passwd')));
});

test('saveAttachment creates separate subfolders per content type', () => {
  const ws = scratchWorkspace();
  saveAttachment(ws, 'projects', 'avatar.png', Buffer.from('x'));
  saveAttachment(ws, 'tasks', 'avatar.png', Buffer.from('y'));

  assert.ok(fs.existsSync(path.join(ws, 'attachments', 'projects', 'avatar.png')));
  assert.ok(fs.existsSync(path.join(ws, 'attachments', 'tasks', 'avatar.png')));
});
