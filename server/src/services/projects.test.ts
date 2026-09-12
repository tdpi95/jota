import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { getHistory } from '../lib/vaultGit.js';
import { ensureGitRepo } from '../lib/workspaces.js';
import { COLOR_PALETTE, createProject, deleteProject, getProject, listProjects, updateProject } from './projects.js';

// Mirrors PLAN.md milestone 7's verify step (the projects half): create a
// project, confirm the file, index, and git history all agree.

function scratchWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poco-projects-'));
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  ensureGitRepo(dir);
  return dir;
}

test('createProject writes frontmatter, auto-assigns color, indexes, and commits', () => {
  const ws = scratchWorkspace();

  const project = createProject(ws, { name: 'Website Redesign' });

  assert.equal(project.slug, 'website-redesign');
  assert.equal(project.frontmatter.name, 'Website Redesign');
  assert.equal(project.frontmatter.color, COLOR_PALETTE[0]);
  assert.equal(project.frontmatter.archived, false);
  assert.deepEqual(project.tasks, []);

  const onDisk = fs.readFileSync(path.join(ws, 'projects', 'website-redesign.md'), 'utf8');
  assert.match(onDisk, /name: Website Redesign/);

  const history = getHistory(ws);
  assert.equal(history[0].message, '[api] create_project website-redesign');

  const fetched = getProject(ws, 'website-redesign');
  assert.deepEqual(fetched, project);
});

test('createProject cycles through the color palette by creation order', () => {
  const ws = scratchWorkspace();
  const a = createProject(ws, { name: 'A' });
  const b = createProject(ws, { name: 'B' });

  assert.equal(a.frontmatter.color, COLOR_PALETTE[0]);
  assert.equal(b.frontmatter.color, COLOR_PALETTE[1]);
});

test('createProject rejects a duplicate slug', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  assert.throws(() => createProject(ws, { name: 'Website Redesign' }), /already exists/);
});

test('updateProject merges only the given fields and commits the change', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign', tags: ['marketing'] });

  const updated = updateProject(ws, 'website-redesign', { description: 'New copy.', archived: true });

  assert.equal(updated.frontmatter.description, 'New copy.');
  assert.equal(updated.frontmatter.archived, true);
  assert.deepEqual(updated.frontmatter.tags, ['marketing']); // untouched field preserved

  const history = getHistory(ws);
  assert.equal(history[0].message, '[api] update_project website-redesign');
});

test('updateProject on an unknown slug throws a structured 404', () => {
  const ws = scratchWorkspace();
  assert.throws(() => updateProject(ws, 'nope', { archived: true }), /no project with slug/);
});

test('deleteProject removes the file, drops it from listProjects, and commits', () => {
  const ws = scratchWorkspace();
  createProject(ws, { name: 'Website Redesign' });
  createProject(ws, { name: 'Other' });

  deleteProject(ws, 'website-redesign');

  assert.ok(!fs.existsSync(path.join(ws, 'projects', 'website-redesign.md')));
  assert.deepEqual(
    listProjects(ws).map((p) => p.slug),
    ['other'],
  );
  assert.equal(getHistory(ws)[0].message, '[api] delete_project website-redesign');
});
