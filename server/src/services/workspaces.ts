// Workspace management service — the one implementation of "add/open/remove
// a workspace" that both routes/workspaces.ts and (later) the MCP server
// call. See PLAN.md "Workspaces" and milestone 2.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { HttpError } from '../lib/httpError.js';
import { ensureGitHistory } from '../lib/vaultGit.js';
import { readRegistry, scaffoldWorkspaceDirs, writeRegistry, type WorkspaceEntry } from '../lib/workspaces.js';

/** Structured error for the routes layer to translate into an HTTP status. */
export class WorkspaceServiceError extends HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'WorkspaceServiceError';
  }
}

export interface AddWorkspaceInput {
  path: string;
  name?: string;
}

export function listWorkspaces(homeDir: string = os.homedir()): WorkspaceEntry[] {
  return readRegistry(homeDir).workspaces;
}

export function getActiveWorkspace(homeDir: string = os.homedir()): WorkspaceEntry | null {
  const registry = readRegistry(homeDir);
  if (!registry.activeWorkspaceId) return null;
  return registry.workspaces.find((w) => w.id === registry.activeWorkspaceId) ?? null;
}

/** Same as getActiveWorkspace, but throws a structured 400 instead of
 * returning null — used by routes (index/vault) that only make sense against
 * a currently-open workspace. */
export function getActiveWorkspaceOrThrow(homeDir: string = os.homedir()): WorkspaceEntry {
  const workspace = getActiveWorkspace(homeDir);
  if (!workspace) throw new WorkspaceServiceError('no active workspace', 400);
  return workspace;
}

/**
 * Registers a folder as a workspace and makes it the active one — the
 * "+ Open folder" flow. Adopting an already-registered path (re-opening it
 * from the OS picker) just activates the existing entry rather than creating
 * a duplicate. Scaffolds `.pivot/`/`projects/`/`journal/` and `git init`s the
 * folder if needed; an existing folder with content is adopted as-is.
 */
export function addWorkspace(input: AddWorkspaceInput, homeDir: string = os.homedir()): WorkspaceEntry {
  const resolvedPath = path.resolve(input.path);
  const registry = readRegistry(homeDir);

  const existing = registry.workspaces.find((w) => w.path === resolvedPath);
  if (existing) return openWorkspace(existing.id, homeDir);

  if (fs.existsSync(resolvedPath)) {
    if (!fs.statSync(resolvedPath).isDirectory()) {
      throw new WorkspaceServiceError(`${resolvedPath} is not a directory`, 400);
    }
  } else {
    fs.mkdirSync(resolvedPath, { recursive: true });
  }

  scaffoldWorkspaceDirs(resolvedPath);
  ensureGitHistory(resolvedPath);

  const entry: WorkspaceEntry = {
    id: randomUUID(),
    path: resolvedPath,
    name: input.name?.trim() || path.basename(resolvedPath),
    lastOpenedAt: new Date().toISOString(),
  };
  registry.workspaces.push(entry);
  registry.activeWorkspaceId = entry.id;
  writeRegistry(registry, homeDir);
  return entry;
}

/**
 * Switches the active workspace among already-registered ones. Re-scaffolds
 * the target's `.pivot/` dirs first, so a workspace folder that was copied
 * or moved without them self-heals on open (PLAN.md "Workspaces").
 */
export function openWorkspace(id: string, homeDir: string = os.homedir()): WorkspaceEntry {
  const registry = readRegistry(homeDir);
  const entry = registry.workspaces.find((w) => w.id === id);
  if (!entry) throw new WorkspaceServiceError(`no workspace with id ${id}`, 404);

  scaffoldWorkspaceDirs(entry.path);
  ensureGitHistory(entry.path);

  entry.lastOpenedAt = new Date().toISOString();
  registry.activeWorkspaceId = entry.id;
  writeRegistry(registry, homeDir);
  return entry;
}

/**
 * Un-registers a workspace only — never deletes its folder or contents
 * (PLAN.md: same as Obsidian's "Remove from list"). If it was the active
 * workspace, clears the active pointer rather than guessing a replacement.
 */
export function removeWorkspace(id: string, homeDir: string = os.homedir()): void {
  const registry = readRegistry(homeDir);
  const index = registry.workspaces.findIndex((w) => w.id === id);
  if (index === -1) throw new WorkspaceServiceError(`no workspace with id ${id}`, 404);

  registry.workspaces.splice(index, 1);
  if (registry.activeWorkspaceId === id) registry.activeWorkspaceId = null;
  writeRegistry(registry, homeDir);
}

export type { WorkspaceEntry };
