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

/** PLAN.md "Daily reminder": "default '20:00' on a newly-added workspace". */
const DEFAULT_REMINDER_TIME = '20:00';

export interface ReminderSettings {
  enabled: boolean;
  /** 24h "HH:MM" local time, or null when disabled. */
  time: string | null;
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
    reminderTime: DEFAULT_REMINDER_TIME,
    lastReminderFiredDate: null,
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

function reminderSettingsOf(entry: WorkspaceEntry): ReminderSettings {
  const time = entry.reminderTime === undefined ? DEFAULT_REMINDER_TIME : entry.reminderTime;
  return { enabled: time !== null, time };
}

function findEntryOrThrow(id: string, registry: ReturnType<typeof readRegistry>): WorkspaceEntry {
  const entry = registry.workspaces.find((w) => w.id === id);
  if (!entry) throw new WorkspaceServiceError(`no workspace with id ${id}`, 404);
  return entry;
}

/** `window.pivot.getReminderSettings()` (via `electron/src/main.ts`'s IPC
 * handler, over HTTP) — the active workspace's daily-reminder time, PLAN.md
 * "Daily reminder". */
export function getReminderSettings(homeDir: string = os.homedir()): ReminderSettings {
  return reminderSettingsOf(getActiveWorkspaceOrThrow(homeDir));
}

/** `window.pivot.setReminderSettings(...)`. `enabled: false` persists as
 * `reminderTime: null`; `enabled: true` with no `time` falls back to the
 * same default a newly-added workspace gets. */
export function setReminderSettings(settings: ReminderSettings, homeDir: string = os.homedir()): ReminderSettings {
  const active = getActiveWorkspaceOrThrow(homeDir);
  const registry = readRegistry(homeDir);
  const entry = findEntryOrThrow(active.id, registry);
  entry.reminderTime = settings.enabled ? (settings.time ?? DEFAULT_REMINDER_TIME) : null;
  writeRegistry(registry, homeDir);
  return reminderSettingsOf(entry);
}

/**
 * Records that the daily reminder actually fired for the active workspace
 * today — called once by `electron/src/reminder.ts` right after it shows
 * the notification (never on a skip), so a later tick the same day doesn't
 * refire (PLAN.md "Daily reminder"). `date` is supplied by the caller
 * (local YYYY-MM-DD) rather than computed here — all wall-clock/local-date
 * logic for the reminder lives in the Electron scheduler; the server only
 * ever stores what it's told.
 */
export function markReminderFired(date: string, homeDir: string = os.homedir()): string {
  const active = getActiveWorkspaceOrThrow(homeDir);
  const registry = readRegistry(homeDir);
  const entry = findEntryOrThrow(active.id, registry);
  entry.lastReminderFiredDate = date;
  writeRegistry(registry, homeDir);
  return date;
}

/**
 * The app-wide launch-at-login *preference record* — not the live OS
 * truth (that's `electron/src/loginItem.ts`, which reads/writes it
 * directly via `app.getLoginItemSettings`/`setLoginItemSettings`, the only
 * process with access to that API). This is purely the breadcrumb
 * `electron/src/main.ts` uses to know whether the one-time "on by default
 * for a new install" logic (PLAN.md "Daily reminder") has already run —
 * `null` means it hasn't.
 */
export function getLaunchAtLoginPreference(homeDir: string = os.homedir()): boolean | null {
  return readRegistry(homeDir).launchAtLogin ?? null;
}

export function setLaunchAtLoginPreference(enabled: boolean, homeDir: string = os.homedir()): boolean {
  const registry = readRegistry(homeDir);
  registry.launchAtLogin = enabled;
  writeRegistry(registry, homeDir);
  return enabled;
}

/**
 * The app-wide UI language (PLAN.md "Localization") — one value for the
 * whole app, independent of which workspace is open, read by both the
 * client (via `GET/PUT /api/preferences/language`) and the Electron main
 * process (tray menu + daily-reminder notification text). `undefined` on
 * the registry (never set, or a registry written before this field
 * existed) normalizes to `'en'` here rather than staying unset — unlike
 * `launchAtLogin`, there's no OS-level default-application step that needs
 * to distinguish "never decided" from "explicitly en".
 */
export function getLanguagePreference(homeDir: string = os.homedir()): 'en' | 'vi' {
  return readRegistry(homeDir).language ?? 'en';
}

export function setLanguagePreference(language: 'en' | 'vi', homeDir: string = os.homedir()): 'en' | 'vi' {
  const registry = readRegistry(homeDir);
  registry.language = language;
  writeRegistry(registry, homeDir);
  return language;
}

export type { WorkspaceEntry };
