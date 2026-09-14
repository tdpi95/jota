// Journal entry service (PLAN.md "Backend" + milestone 8) — the one
// implementation both routes/journal.ts and (later) the MCP server call.
// Single-entry reads/writes always go straight to the file (never the
// index, per PLAN.md "which reads go where"); the year listing is the one
// aggregate view here and reads from the index instead.

import fs from 'node:fs';
import path from 'node:path';

import { HttpError } from '../lib/httpError.js';
import { reconcileWorkspace } from '../lib/index/reindex.js';
import { openIndexDb } from '../lib/index/db.js';
import { parseJournalFile, serializeJournalFile, type ParsedJournalFile } from '../lib/markdown/journal.js';
import { commitChange } from '../lib/vaultGit.js';
import type { JournalFrontmatter } from '../types.js';

export class JournalServiceError extends HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'JournalServiceError';
  }
}

export interface JournalEntry {
  date: string;
  frontmatter: JournalFrontmatter;
  body: string;
}

export interface JournalEntrySummary {
  date: string;
  hasBody: boolean;
  tags: string[];
}

export interface JournalEntryFull extends JournalEntrySummary {
  body: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_RE = /^\d{4}$/;

function yearOf(date: string): string {
  return date.slice(0, 4);
}

function journalFilePath(workspacePath: string, date: string): string {
  return path.join(workspacePath, 'journal', yearOf(date), `${date}.md`);
}

function journalRelPath(date: string): string {
  return path.join('journal', yearOf(date), `${date}.md`);
}

function validateDate(year: string, date: string): void {
  if (!DATE_RE.test(date)) throw new JournalServiceError(`invalid date "${date}", expected YYYY-MM-DD`, 400);
  if (yearOf(date) !== year) throw new JournalServiceError(`year "${year}" does not match date "${date}"`, 400);
}

function emptyEntry(date: string): JournalEntry {
  return { date, frontmatter: { date, tags: [], linkedTasks: [] }, body: '' };
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Reads one day's entry directly from disk. Returns a default, unpersisted
 * empty entry if the file doesn't exist yet rather than 404ing — the
 * frontend's journal day page (and "+ log to today") needs something
 * editable to show for any date, and creating a file for every date someone
 * merely opens would spam empty commits. Nothing is written until an actual
 * `putJournalEntry`/`linkTask`.
 */
export function getJournalEntry(workspacePath: string, year: string, date: string): JournalEntry {
  validateDate(year, date);
  const filePath = journalFilePath(workspacePath, date);
  if (!fs.existsSync(filePath)) return emptyEntry(date);
  const parsed = parseJournalFile(fs.readFileSync(filePath, 'utf8'));
  return { date, frontmatter: parsed.frontmatter, body: parsed.body };
}

function writeJournalFile(workspacePath: string, date: string, parsed: ParsedJournalFile, origin: string, message: string): void {
  const filePath = journalFilePath(workspacePath, date);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serializeJournalFile(parsed), 'utf8');
  try {
    reconcileWorkspace(workspacePath);
  } catch (err) {
    console.error(`[journal] index reconcile failed for ${workspacePath}:`, (err as Error).message);
  }
  commitChange(workspacePath, { origin, message, paths: [journalRelPath(date)] });
}

export interface PutJournalInput {
  tags?: string[];
  linkedTasks?: string[];
  body?: string;
}

/** `PUT /api/journal/:year/:date` — full-replace of the given fields (PLAN.md
 * "PUT accepts linkedTasks full-replace"); fields omitted from the input
 * keep whatever the entry already had (or the default, if new). */
export function putJournalEntry(workspacePath: string, year: string, date: string, input: PutJournalInput, origin = 'api'): JournalEntry {
  validateDate(year, date);
  const existing = getJournalEntry(workspacePath, year, date);
  const frontmatter: JournalFrontmatter = {
    date,
    tags: input.tags ?? existing.frontmatter.tags,
    linkedTasks: dedupe(input.linkedTasks ?? existing.frontmatter.linkedTasks),
  };
  const body = input.body ?? existing.body;

  writeJournalFile(workspacePath, date, { frontmatter, body }, origin, `upsert_journal_entry ${date}`);
  return { date, frontmatter, body };
}

/** `POST /api/journal/:year/:date/links/:taskId` — idempotent add, and
 * auto-creates the day's file if it doesn't exist yet (PLAN.md). A no-op
 * (no write/reindex/commit) if already linked. */
export function linkTask(workspacePath: string, year: string, date: string, taskId: string, origin = 'api'): JournalEntry {
  validateDate(year, date);
  const existing = getJournalEntry(workspacePath, year, date);
  if (existing.frontmatter.linkedTasks.includes(taskId)) return existing;

  const frontmatter: JournalFrontmatter = { ...existing.frontmatter, linkedTasks: [...existing.frontmatter.linkedTasks, taskId] };
  writeJournalFile(workspacePath, date, { frontmatter, body: existing.body }, origin, `link_task ${taskId} to ${date}`);
  return { date, frontmatter, body: existing.body };
}

/** `DELETE /api/journal/:year/:date/links/:taskId` — idempotent remove. A
 * no-op if the entry doesn't exist yet or the task isn't linked; there's
 * nothing to remove either way, so this never needs to create a file. */
export function unlinkTask(workspacePath: string, year: string, date: string, taskId: string, origin = 'api'): JournalEntry {
  validateDate(year, date);
  const existing = getJournalEntry(workspacePath, year, date);
  if (!existing.frontmatter.linkedTasks.includes(taskId)) return existing;

  const frontmatter: JournalFrontmatter = {
    ...existing.frontmatter,
    linkedTasks: existing.frontmatter.linkedTasks.filter((id) => id !== taskId),
  };
  writeJournalFile(workspacePath, date, { frontmatter, body: existing.body }, origin, `unlink_task ${taskId} from ${date}`);
  return { date, frontmatter, body: existing.body };
}

/** `GET /api/journal/:year` — the one aggregate view here; reads from the
 * index rather than walking `journal/<year>/*.md` directly (PLAN.md "which
 * reads go where"). */
export function listJournalYear(workspacePath: string, year: string): JournalEntrySummary[] {
  if (!YEAR_RE.test(year)) throw new JournalServiceError(`invalid year "${year}", expected YYYY`, 400);
  const db = openIndexDb(workspacePath);
  try {
    const rows = db.prepare('SELECT date, has_body, tags FROM journal_entries WHERE year = ? ORDER BY date').all(year) as {
      date: string;
      has_body: number;
      tags: string;
    }[];
    return rows.map((r) => ({ date: r.date, hasBody: r.has_body === 1, tags: JSON.parse(r.tags) as string[] }));
  } finally {
    db.close();
  }
}

/** `GET /api/journal/:year/full` — every day in the year that has a file,
 * body included (unlike `listJournalYear`, whose index-backed summary is
 * cheap precisely because it omits body). Backs CalendarPage's "show all
 * journal entries" list, which needs the actual text to preview/expand, so
 * this reads the year's files directly off disk rather than the index — the
 * index only ever caches hasBody/tags, never body text, and per PLAN.md the
 * index must never be required to interpret vault content correctly. Bounded
 * to at most ~366 small files, so a plain synchronous read of all of them is
 * fine. */
export function listJournalYearFull(workspacePath: string, year: string): JournalEntryFull[] {
  if (!YEAR_RE.test(year)) throw new JournalServiceError(`invalid year "${year}", expected YYYY`, 400);
  const yearDir = path.join(workspacePath, 'journal', year);
  if (!fs.existsSync(yearDir)) return [];
  const files = fs.readdirSync(yearDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
  const entries = files.map((file) => {
    const date = file.slice(0, -'.md'.length);
    const parsed = parseJournalFile(fs.readFileSync(path.join(yearDir, file), 'utf8'));
    return { date, hasBody: parsed.body.trim().length > 0, tags: parsed.frontmatter.tags, body: parsed.body };
  });
  entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  return entries;
}
