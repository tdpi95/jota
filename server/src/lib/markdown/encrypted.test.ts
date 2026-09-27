import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ensureGitRepo } from '../workspaces.js';
import { getJournalEntry, putJournalEntry } from '../../services/journal.js';
import { createNote, updateNote } from '../../services/notes.js';
import { searchEverything } from '../../services/search.js';
import { listEncryptedTokens, missingEncryptedTokens, stripEncryptedTokens } from './encrypted.js';

// Milestone 31 ("Encryption"): the server never decrypts, it only recognizes
// tokens — to keep ciphertext out of the index and to stop an MCP write
// from dropping one.

const TOKEN_A = '`jota-enc:v1:pbkdf2-sha256:600000:c2FsdA==:aXY=:QUFBQQ==`';
const TOKEN_B = '`jota-enc:v1:pbkdf2-sha256:600000:c2FsdA==:aXYy:QkJCQkJCQkJC`';

function scratchWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jota-encrypted-'));
  for (const sub of ['projects', 'journal', 'notes']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  ensureGitRepo(dir);
  return dir;
}

test('listEncryptedTokens / stripEncryptedTokens find every inline token and leave the rest intact', () => {
  const body = `before ${TOKEN_A} middle\n- item ${TOKEN_B} after\n\nplain \`code\` span\n`;
  assert.deepEqual(listEncryptedTokens(body), [TOKEN_A, TOKEN_B]);
  const stripped = stripEncryptedTokens(body);
  assert.ok(!stripped.includes('jota-enc'));
  assert.equal(stripped, 'before  middle\n- item  after\n\nplain `code` span\n');
});

test('missingEncryptedTokens reports a dropped or altered token, not a moved one', () => {
  const body = `${TOKEN_A} text ${TOKEN_B}`;
  assert.deepEqual(missingEncryptedTokens(body, `${TOKEN_B}\nnew text ${TOKEN_A}`), []);
  assert.deepEqual(missingEncryptedTokens(body, `${TOKEN_A} text`), [TOKEN_B]);
  assert.deepEqual(missingEncryptedTokens(body, body.replace('QUFBQQ==', 'QUFBQg==')), [TOKEN_A]);
});

test('an MCP journal write that drops an encrypted token is rejected; an api write is not', () => {
  const ws = scratchWorkspace();
  putJournalEntry(ws, '2026', '2026-09-26', { body: `hello\n\n${TOKEN_A}\n` });
  assert.throws(
    () => putJournalEntry(ws, '2026', '2026-09-26', { body: 'hello' }, 'mcp:upsert_journal_entry'),
    (err: Error & { statusCode?: number }) => err.statusCode === 409,
  );
  // Appending around the token (and tag-only writes) is fine for an agent.
  putJournalEntry(ws, '2026', '2026-09-26', { body: `hello\n\n${TOKEN_A}\n\nmore`, tags: ['x'] }, 'mcp:upsert_journal_entry');
  putJournalEntry(ws, '2026', '2026-09-26', { tags: ['y'] }, 'mcp:upsert_journal_entry');
  putJournalEntry(ws, '2026', '2026-09-26', { body: 'removed in the app' });
  assert.equal(getJournalEntry(ws, '2026', '2026-09-26').body.trim(), 'removed in the app');
});

test('an MCP note update that alters an encrypted token is rejected', () => {
  const ws = scratchWorkspace();
  const note = createNote(ws, { title: 'Secret', body: TOKEN_A });
  assert.throws(
    () => updateNote(ws, note.slug, { body: TOKEN_A.replace('QUFBQQ==', 'Zm9v') }, 'mcp:update_note'),
    (err: Error & { statusCode?: number }) => err.statusCode === 409,
  );
  updateNote(ws, note.slug, { title: 'Renamed' }, 'mcp:update_note');
});

test('ciphertext never reaches the search index', () => {
  const ws = scratchWorkspace();
  putJournalEntry(ws, '2026', '2026-09-26', { body: `visible words\n\n${TOKEN_B}\n` });
  createNote(ws, { title: 'Plain', body: `note words\n\n${TOKEN_B}\n` });
  assert.equal(searchEverything(ws, { query: 'QkJCQkJCQkJC' }).length, 0);
  assert.equal(searchEverything(ws, { query: 'pbkdf2' }).length, 0);
  assert.equal(searchEverything(ws, { query: 'visible' }).length, 1);
  assert.equal(searchEverything(ws, { query: 'note words' }).length, 1);
});
