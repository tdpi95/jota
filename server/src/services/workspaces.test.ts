import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getIndexStatus } from '../lib/index/reindex.js';
import { readRegistry, writeRegistry } from '../lib/workspaces.js';
import {
  addWorkspace,
  getAccentPalettePreference,
  getActiveWorkspace,
  getAutosaveIntervalPreference,
  getCalendarGranularityPreference,
  getCalendarModePreference,
  getDashboardGroupFilterPreference,
  getDashboardRecentProjectsOpenPreference,
  getLanguagePreference,
  getLaunchAtLoginPreference,
  getReminderSettings,
  getThemePreference,
  listWorkspaces,
  markReminderFired,
  openWorkspace,
  removeWorkspace,
  setAccentPalettePreference,
  setAutosaveIntervalPreference,
  setCalendarGranularityPreference,
  setCalendarModePreference,
  setDashboardGroupFilterPreference,
  setDashboardRecentProjectsOpenPreference,
  setLanguagePreference,
  setLaunchAtLoginPreference,
  setReminderSettings,
  setThemePreference,
} from './workspaces.js';

// Every test gets its own scratch $HOME so ~/.poco/config.json never touches
// the real one, mirroring PLAN.md milestone 2's verify step: register two
// scratch folders, switch between them, confirm isolation and that removing
// a workspace never touches its folder.
function scratchDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('add registers a workspace, scaffolds its dirs, and activates it', () => {
  const homeDir = scratchDir('poco-home-');
  const vaultA = scratchDir('poco-vault-a-');

  const entry = addWorkspace({ path: vaultA, name: 'Vault A' }, homeDir);

  assert.equal(entry.path, path.resolve(vaultA));
  assert.equal(entry.name, 'Vault A');
  assert.equal(getActiveWorkspace(homeDir)?.id, entry.id);
  assert.deepEqual(listWorkspaces(homeDir).map((w) => w.id), [entry.id]);

  for (const dir of ['projects', 'journal', path.join('.poco', 'cache'), path.join('.poco', 'backups'), '.git']) {
    assert.ok(fs.existsSync(path.join(vaultA, dir)), `expected ${dir} to be scaffolded`);
  }
  const gitignore = fs.readFileSync(path.join(vaultA, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.poco\/$/m);
});

test('switching between two workspaces keeps each scoped to its own folder', () => {
  const homeDir = scratchDir('poco-home-');
  const vaultA = scratchDir('poco-vault-a-');
  const vaultB = scratchDir('poco-vault-b-');

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
  const homeDir = scratchDir('poco-home-');
  const vaultA = scratchDir('poco-vault-a-');

  const first = addWorkspace({ path: vaultA }, homeDir);
  const second = addWorkspace({ path: vaultA }, homeDir);

  assert.equal(first.id, second.id);
  assert.equal(listWorkspaces(homeDir).length, 1);
});

test('removing a workspace un-registers it without touching its folder', () => {
  const homeDir = scratchDir('poco-home-');
  const vaultA = scratchDir('poco-vault-a-');

  const entry = addWorkspace({ path: vaultA }, homeDir);
  fs.writeFileSync(path.join(vaultA, 'projects', 'keep-me.md'), '# still here\n', 'utf8');
  removeWorkspace(entry.id, homeDir);

  assert.deepEqual(listWorkspaces(homeDir), []);
  assert.equal(getActiveWorkspace(homeDir), null);
  assert.ok(fs.existsSync(path.join(vaultA, 'projects', 'keep-me.md')), 'folder/content must survive removal');
});

test('opening a workspace whose .poco dir was deleted self-heals it', () => {
  const homeDir = scratchDir('poco-home-');
  const vaultA = scratchDir('poco-vault-a-');

  const entry = addWorkspace({ path: vaultA }, homeDir);
  fs.rmSync(path.join(vaultA, '.poco'), { recursive: true, force: true });
  assert.ok(!fs.existsSync(path.join(vaultA, '.poco')));

  openWorkspace(entry.id, homeDir);
  assert.ok(fs.existsSync(path.join(vaultA, '.poco', 'cache')));
});

const EXTERNAL_PROJECT_MD = `---
name: External
created: '2026-01-01'
archived: false
description: ''
color: '#4f86f7'
---
`;

// Regression coverage for a real bug: search returned nothing for content
// that genuinely existed, because a workspace already open (or a folder
// with existing, never-yet-indexed content) had nothing trigger
// `reconcileWorkspace` for it — that used to only ever run from a mutating
// write (create/update/delete a task/note/journal entry), never from
// opening/adding a workspace, despite PLAN.md documenting reconciliation as
// running "whenever a workspace is opened, not just process boot".

test('adding a brand-new workspace over an existing folder with content indexes it immediately, not just on the next write', () => {
  const homeDir = scratchDir('poco-home-');
  const vaultA = scratchDir('poco-vault-a-');
  fs.mkdirSync(path.join(vaultA, 'projects'), { recursive: true });
  // Written directly to disk — never through any service write path, same
  // as a folder of pre-existing notes someone points poco at, or a hand
  // edit made before the workspace was ever registered.
  fs.writeFileSync(path.join(vaultA, 'projects', 'external.md'), EXTERNAL_PROJECT_MD, 'utf8');

  addWorkspace({ path: vaultA }, homeDir);

  assert.equal(getIndexStatus(vaultA).projectCount, 1);
});

test('opening an already-registered workspace picks up a file dropped onto disk since it was last indexed', () => {
  const homeDir = scratchDir('poco-home-');
  const vaultA = scratchDir('poco-vault-a-');
  const vaultB = scratchDir('poco-vault-b-');

  const a = addWorkspace({ path: vaultA }, homeDir);
  addWorkspace({ path: vaultB }, homeDir); // switches active away from A

  // Simulate a file that appeared on disk while A wasn't the active
  // workspace (an external sync tool, a hand edit, or — the actual case
  // that surfaced this — an index-schema upgrade that needs existing
  // content reparsed) — nothing yet has re-reconciled A for it.
  fs.writeFileSync(path.join(vaultA, 'projects', 'external.md'), EXTERNAL_PROJECT_MD, 'utf8');
  assert.equal(getIndexStatus(vaultA).projectCount, 0);

  openWorkspace(a.id, homeDir);

  assert.equal(getIndexStatus(vaultA).projectCount, 1);
});

test('opening an unknown id throws a structured 404 error', () => {
  const homeDir = scratchDir('poco-home-');
  assert.throws(() => openWorkspace('does-not-exist', homeDir), /no workspace with id/);
});

test('a newly-added workspace defaults its reminder to 20:00 enabled', () => {
  const homeDir = scratchDir('poco-home-');
  const vaultA = scratchDir('poco-vault-a-');
  addWorkspace({ path: vaultA }, homeDir);

  assert.deepEqual(getReminderSettings(homeDir), { enabled: true, time: '20:00' });
});

test('an entry written before the reminder field existed still defaults to 20:00, not disabled', () => {
  const homeDir = scratchDir('poco-home-');
  const vaultA = scratchDir('poco-vault-a-');
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
  const homeDir = scratchDir('poco-home-');
  const vaultA = scratchDir('poco-vault-a-');
  addWorkspace({ path: vaultA }, homeDir);

  assert.deepEqual(setReminderSettings({ enabled: true, time: '07:30' }, homeDir), { enabled: true, time: '07:30' });
  assert.deepEqual(getReminderSettings(homeDir), { enabled: true, time: '07:30' });

  assert.deepEqual(setReminderSettings({ enabled: false, time: null }, homeDir), { enabled: false, time: null });
  assert.deepEqual(getReminderSettings(homeDir), { enabled: false, time: null });
});

test('markReminderFired records the given local date on the active workspace only', () => {
  const homeDir = scratchDir('poco-home-');
  const vaultA = scratchDir('poco-vault-a-');
  const vaultB = scratchDir('poco-vault-b-');
  const a = addWorkspace({ path: vaultA }, homeDir);
  addWorkspace({ path: vaultB }, homeDir); // B is now active

  markReminderFired('2026-09-11', homeDir);

  const registry = readRegistry(homeDir);
  assert.equal(registry.workspaces.find((w) => w.id === a.id)?.lastReminderFiredDate, null);
  assert.equal(getActiveWorkspace(homeDir)?.lastReminderFiredDate, '2026-09-11');
});

test('launch-at-login preference is null until explicitly set, then persists the exact value', () => {
  const homeDir = scratchDir('poco-home-');
  assert.equal(getLaunchAtLoginPreference(homeDir), null);

  setLaunchAtLoginPreference(true, homeDir);
  assert.equal(getLaunchAtLoginPreference(homeDir), true);

  setLaunchAtLoginPreference(false, homeDir);
  assert.equal(getLaunchAtLoginPreference(homeDir), false);
});

test('language preference defaults to en and persists an explicit choice', () => {
  const homeDir = scratchDir('poco-home-');
  assert.equal(getLanguagePreference(homeDir), 'en');

  setLanguagePreference('vi', homeDir);
  assert.equal(getLanguagePreference(homeDir), 'vi');

  setLanguagePreference('en', homeDir);
  assert.equal(getLanguagePreference(homeDir), 'en');
});

test('theme preference defaults to light and persists an explicit choice', () => {
  const homeDir = scratchDir('poco-home-');
  assert.equal(getThemePreference(homeDir), 'light');

  setThemePreference('dark', homeDir);
  assert.equal(getThemePreference(homeDir), 'dark');

  setThemePreference('light', homeDir);
  assert.equal(getThemePreference(homeDir), 'light');
});

test('accent palette preference defaults to default and persists an explicit choice', () => {
  const homeDir = scratchDir('poco-home-');
  assert.equal(getAccentPalettePreference(homeDir), 'default');

  for (const palette of ['green', 'blue', 'violet', 'default'] as const) {
    setAccentPalettePreference(palette, homeDir);
    assert.equal(getAccentPalettePreference(homeDir), palette);
  }
});

test('calendar mode preference defaults to due and persists an explicit choice', () => {
  const homeDir = scratchDir('poco-home-');
  assert.equal(getCalendarModePreference(homeDir), 'due');

  setCalendarModePreference('journal', homeDir);
  assert.equal(getCalendarModePreference(homeDir), 'journal');

  setCalendarModePreference('due', homeDir);
  assert.equal(getCalendarModePreference(homeDir), 'due');
});

test('calendar granularity preference defaults to month and persists an explicit choice', () => {
  const homeDir = scratchDir('poco-home-');
  assert.equal(getCalendarGranularityPreference(homeDir), 'month');

  setCalendarGranularityPreference('year', homeDir);
  assert.equal(getCalendarGranularityPreference(homeDir), 'year');

  setCalendarGranularityPreference('month', homeDir);
  assert.equal(getCalendarGranularityPreference(homeDir), 'month');
});

test('autosave interval preference defaults to 30 seconds and persists an explicit choice', () => {
  const homeDir = scratchDir('poco-home-');
  assert.equal(getAutosaveIntervalPreference(homeDir), 30);

  setAutosaveIntervalPreference(60, homeDir);
  assert.equal(getAutosaveIntervalPreference(homeDir), 60);

  setAutosaveIntervalPreference(5, homeDir);
  assert.equal(getAutosaveIntervalPreference(homeDir), 5);
});

test('dashboard recent-projects-open preference defaults to true and persists an explicit choice', () => {
  const homeDir = scratchDir('poco-home-');
  assert.equal(getDashboardRecentProjectsOpenPreference(homeDir), true);

  setDashboardRecentProjectsOpenPreference(false, homeDir);
  assert.equal(getDashboardRecentProjectsOpenPreference(homeDir), false);

  setDashboardRecentProjectsOpenPreference(true, homeDir);
  assert.equal(getDashboardRecentProjectsOpenPreference(homeDir), true);
});

test('dashboard group-filter preference defaults to empty and persists an explicit choice', () => {
  const homeDir = scratchDir('poco-home-');
  assert.deepEqual(getDashboardGroupFilterPreference(homeDir), []);

  setDashboardGroupFilterPreference(['Work', 'Personal'], homeDir);
  assert.deepEqual(getDashboardGroupFilterPreference(homeDir), ['Work', 'Personal']);

  setDashboardGroupFilterPreference([], homeDir);
  assert.deepEqual(getDashboardGroupFilterPreference(homeDir), []);
});
