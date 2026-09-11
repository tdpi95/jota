import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readRegistry, writeRegistry } from '../lib/workspaces.js';
import {
  addWorkspace,
  getActiveWorkspace,
  getLanguagePreference,
  getLaunchAtLoginPreference,
  getReminderSettings,
  listWorkspaces,
  markReminderFired,
  openWorkspace,
  removeWorkspace,
  setLanguagePreference,
  setLaunchAtLoginPreference,
  setReminderSettings,
} from './workspaces.js';

// Every test gets its own scratch $HOME so ~/.pivot/config.json never touches
// the real one, mirroring PLAN.md milestone 2's verify step: register two
// scratch folders, switch between them, confirm isolation and that removing
// a workspace never touches its folder.
function scratchDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('add registers a workspace, scaffolds its dirs, and activates it', () => {
  const homeDir = scratchDir('pivot-home-');
  const vaultA = scratchDir('pivot-vault-a-');

  const entry = addWorkspace({ path: vaultA, name: 'Vault A' }, homeDir);

  assert.equal(entry.path, path.resolve(vaultA));
  assert.equal(entry.name, 'Vault A');
  assert.equal(getActiveWorkspace(homeDir)?.id, entry.id);
  assert.deepEqual(listWorkspaces(homeDir).map((w) => w.id), [entry.id]);

  for (const dir of ['projects', 'journal', path.join('.pivot', 'cache'), path.join('.pivot', 'backups'), '.git']) {
    assert.ok(fs.existsSync(path.join(vaultA, dir)), `expected ${dir} to be scaffolded`);
  }
  const gitignore = fs.readFileSync(path.join(vaultA, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.pivot\/$/m);
});

test('switching between two workspaces keeps each scoped to its own folder', () => {
  const homeDir = scratchDir('pivot-home-');
  const vaultA = scratchDir('pivot-vault-a-');
  const vaultB = scratchDir('pivot-vault-b-');

  const a = addWorkspace({ path: vaultA }, homeDir);
  const b = addWorkspace({ path: vaultB }, homeDir);

  // Adding B made it active; opening A should switch back.
  assert.equal(getActiveWorkspace(homeDir)?.id, b.id);
  openWorkspace(a.id, homeDir);
  assert.equal(getActiveWorkspace(homeDir)?.id, a.id);

  const registered = listWorkspaces(homeDir);
  assert.equal(registered.length, 2);
  assert.notEqual(registered[0]?.path, registered[1]?.path);
});

test('re-adding an already-registered path adopts it instead of duplicating', () => {
  const homeDir = scratchDir('pivot-home-');
  const vaultA = scratchDir('pivot-vault-a-');

  const first = addWorkspace({ path: vaultA }, homeDir);
  const second = addWorkspace({ path: vaultA }, homeDir);

  assert.equal(first.id, second.id);
  assert.equal(listWorkspaces(homeDir).length, 1);
});

test('removing a workspace un-registers it without touching its folder', () => {
  const homeDir = scratchDir('pivot-home-');
  const vaultA = scratchDir('pivot-vault-a-');

  const entry = addWorkspace({ path: vaultA }, homeDir);
  fs.writeFileSync(path.join(vaultA, 'projects', 'keep-me.md'), '# still here\n', 'utf8');
  removeWorkspace(entry.id, homeDir);

  assert.deepEqual(listWorkspaces(homeDir), []);
  assert.equal(getActiveWorkspace(homeDir), null);
  assert.ok(fs.existsSync(path.join(vaultA, 'projects', 'keep-me.md')), 'folder/content must survive removal');
});

test('opening a workspace whose .pivot dir was deleted self-heals it', () => {
  const homeDir = scratchDir('pivot-home-');
  const vaultA = scratchDir('pivot-vault-a-');

  const entry = addWorkspace({ path: vaultA }, homeDir);
  fs.rmSync(path.join(vaultA, '.pivot'), { recursive: true, force: true });
  assert.ok(!fs.existsSync(path.join(vaultA, '.pivot')));

  openWorkspace(entry.id, homeDir);
  assert.ok(fs.existsSync(path.join(vaultA, '.pivot', 'cache')));
});

test('opening an unknown id throws a structured 404 error', () => {
  const homeDir = scratchDir('pivot-home-');
  assert.throws(() => openWorkspace('does-not-exist', homeDir), /no workspace with id/);
});

test('a newly-added workspace defaults its reminder to 20:00 enabled', () => {
  const homeDir = scratchDir('pivot-home-');
  const vaultA = scratchDir('pivot-vault-a-');
  addWorkspace({ path: vaultA }, homeDir);

  assert.deepEqual(getReminderSettings(homeDir), { enabled: true, time: '20:00' });
});

test('an entry written before the reminder field existed still defaults to 20:00, not disabled', () => {
  const homeDir = scratchDir('pivot-home-');
  const vaultA = scratchDir('pivot-vault-a-');
  const entry = addWorkspace({ path: vaultA }, homeDir);

  // Simulate a pre-milestone-17 registry entry: strip the field entirely
  // rather than just setting it to the default, so this actually exercises
  // the `undefined` branch and not a coincidentally-equal value.
  const registry = readRegistry(homeDir);
  const found = registry.workspaces.find((w) => w.id === entry.id)!;
  delete found.reminderTime;
  writeRegistry(registry, homeDir);

  assert.deepEqual(getReminderSettings(homeDir), { enabled: true, time: '20:00' });
});

test('setReminderSettings persists a custom time and disabling clears it to null, not just enabled:false', () => {
  const homeDir = scratchDir('pivot-home-');
  const vaultA = scratchDir('pivot-vault-a-');
  addWorkspace({ path: vaultA }, homeDir);

  assert.deepEqual(setReminderSettings({ enabled: true, time: '07:30' }, homeDir), { enabled: true, time: '07:30' });
  assert.deepEqual(getReminderSettings(homeDir), { enabled: true, time: '07:30' });

  assert.deepEqual(setReminderSettings({ enabled: false, time: null }, homeDir), { enabled: false, time: null });
  assert.deepEqual(getReminderSettings(homeDir), { enabled: false, time: null });
});

test('markReminderFired records the given local date on the active workspace only', () => {
  const homeDir = scratchDir('pivot-home-');
  const vaultA = scratchDir('pivot-vault-a-');
  const vaultB = scratchDir('pivot-vault-b-');
  const a = addWorkspace({ path: vaultA }, homeDir);
  addWorkspace({ path: vaultB }, homeDir); // B is now active

  markReminderFired('2026-09-11', homeDir);

  const registry = readRegistry(homeDir);
  assert.equal(registry.workspaces.find((w) => w.id === a.id)?.lastReminderFiredDate, null);
  assert.equal(getActiveWorkspace(homeDir)?.lastReminderFiredDate, '2026-09-11');
});

test('launch-at-login preference is null until explicitly set, then persists the exact value', () => {
  const homeDir = scratchDir('pivot-home-');
  assert.equal(getLaunchAtLoginPreference(homeDir), null);

  setLaunchAtLoginPreference(true, homeDir);
  assert.equal(getLaunchAtLoginPreference(homeDir), true);

  setLaunchAtLoginPreference(false, homeDir);
  assert.equal(getLaunchAtLoginPreference(homeDir), false);
});

test('language preference defaults to en and persists an explicit choice', () => {
  const homeDir = scratchDir('pivot-home-');
  assert.equal(getLanguagePreference(homeDir), 'en');

  setLanguagePreference('vi', homeDir);
  assert.equal(getLanguagePreference(homeDir), 'vi');

  setLanguagePreference('en', homeDir);
  assert.equal(getLanguagePreference(homeDir), 'en');
});
