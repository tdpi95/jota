import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { getHistory } from '../lib/vaultGit.js';
import { ensureGitRepo } from '../lib/workspaces.js';
import { createNote, deleteNote, getNote, listNotes, NoteServiceError, searchNotes, updateNote } from './notes.js';

// Mirrors PLAN.md's "Notes" verify step: file, index, and git history agree
// after create/update/delete, and a note's slug never changes even when its
// title does.

function scratchWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poco-notes-'));
  fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
  ensureGitRepo(dir);
  return dir;
}

test('createNote writes the file, indexes it, and commits', () => {
  const ws = scratchWorkspace();
  const note = createNote(ws, { title: 'Reading list', tags: ['books'], body: 'Start with Educated.' });

  assert.equal(note.slug, 'reading-list');
  assert.equal(note.frontmatter.title, 'Reading list');
  assert.deepEqual(note.frontmatter.tags, ['books']);
  assert.equal(note.frontmatter.created, note.frontmatter.updated);
  assert.equal(note.body, 'Start with Educated.');

  const onDisk = fs.readFileSync(path.join(ws, 'notes', 'reading-list.md'), 'utf8');
  assert.match(onDisk, /Start with Educated\./);
  assert.equal(getHistory(ws)[0].message, '[api] create_note reading-list');
});

test('createNote rejects a blank title', () => {
  const ws = scratchWorkspace();
  assert.throws(() => createNote(ws, { title: '   ' }), NoteServiceError);
});

test('createNote auto-disambiguates a colliding title instead of erroring', () => {
  const ws = scratchWorkspace();
  const first = createNote(ws, { title: 'Meeting notes' });
  const second = createNote(ws, { title: 'Meeting notes' });
  const third = createNote(ws, { title: 'Meeting Notes' }); // same slug, different case

  assert.equal(first.slug, 'meeting-notes');
  assert.equal(second.slug, 'meeting-notes-2');
  assert.equal(third.slug, 'meeting-notes-3');
});

test('getNote reads directly from disk and 404s with a did-you-mean hint for an unknown slug', () => {
  const ws = scratchWorkspace();
  createNote(ws, { title: 'Reading list' });

  assert.equal(getNote(ws, 'reading-list').frontmatter.title, 'Reading list');
  assert.throws(() => getNote(ws, 'reading-lst'), /no note with slug "reading-lst".*did you mean: reading-list/s);
});

test('updateNote only replaces the fields given, keeps the slug fixed, and always bumps `updated`', async () => {
  const ws = scratchWorkspace();
  const created = createNote(ws, { title: 'Reading list', tags: ['books'], body: 'first' });

  // Force a real clock tick so `updated` is guaranteed to differ.
  await new Promise((r) => setTimeout(r, 5));

  const updated = updateNote(ws, 'reading-list', { body: 'second' });
  assert.equal(updated.slug, 'reading-list');
  assert.equal(updated.body, 'second');
  assert.deepEqual(updated.frontmatter.tags, ['books']); // untouched field preserved
  assert.equal(updated.frontmatter.created, created.frontmatter.created); // never rewritten
  assert.notEqual(updated.frontmatter.updated, created.frontmatter.updated);

  const retitled = updateNote(ws, 'reading-list', { title: 'Books to read' });
  assert.equal(retitled.frontmatter.title, 'Books to read');
  assert.equal(retitled.slug, 'reading-list'); // filename never follows the title
  assert.ok(fs.existsSync(path.join(ws, 'notes', 'reading-list.md')));

  assert.equal(getHistory(ws)[0].message, '[api] update_note reading-list');
});

test('updateNote rejects clearing the title to blank', () => {
  const ws = scratchWorkspace();
  createNote(ws, { title: 'Reading list' });
  assert.throws(() => updateNote(ws, 'reading-list', { title: '  ' }), NoteServiceError);
});

test('deleteNote removes the file and commits; getNote/updateNote 404 afterward', () => {
  const ws = scratchWorkspace();
  createNote(ws, { title: 'Reading list' });

  deleteNote(ws, 'reading-list');
  assert.ok(!fs.existsSync(path.join(ws, 'notes', 'reading-list.md')));
  assert.equal(getHistory(ws)[0].message, '[api] delete_note reading-list');
  assert.throws(() => getNote(ws, 'reading-list'), NoteServiceError);
});

test('deleteNote on an unknown slug throws rather than silently no-op-ing', () => {
  const ws = scratchWorkspace();
  assert.throws(() => deleteNote(ws, 'nope'), NoteServiceError);
});

test('listNotes reads metadata from the index, most-recently-updated first, without body', async () => {
  const ws = scratchWorkspace();
  createNote(ws, { title: 'First', body: 'secret body text' });
  await new Promise((r) => setTimeout(r, 5));
  createNote(ws, { title: 'Second' });

  const notes = listNotes(ws);
  assert.deepEqual(
    notes.map((n) => n.title),
    ['Second', 'First'],
  );
  assert.ok(!('body' in notes[0]));
});

test('searchNotes matches title/tags case-insensitively but never body text', () => {
  const ws = scratchWorkspace();
  createNote(ws, { title: 'Reading list', tags: ['books'] });
  createNote(ws, { title: 'Grocery list', body: 'reading list mentioned here only in the body' });

  const byTitle = searchNotes(ws, 'READING');
  assert.deepEqual(
    byTitle.map((n) => n.title),
    ['Reading list'],
  );

  const byTag = searchNotes(ws, 'books');
  assert.deepEqual(
    byTag.map((n) => n.title),
    ['Reading list'],
  );
});
