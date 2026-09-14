// Note CRUD service (PLAN.md "Notes") — the one implementation both
// routes/notes.ts and mcp/tools.ts call. Write path follows PLAN.md's usual
// order: read -> parse -> mutate -> serialize -> write file (authoritative)
// -> upsert index (best-effort) -> git commit (best-effort) -> return the
// in-memory structured form.

import fs from 'node:fs';
import path from 'node:path';

import { didYouMean } from '../lib/didYouMean.js';
import { HttpError } from '../lib/httpError.js';
import { reconcileWorkspace } from '../lib/index/reindex.js';
import { queryAllNotes, querySearchNotes, type IndexedNote } from '../lib/index/queries.js';
import { parseNoteFile, serializeNoteFile, type ParsedNoteFile } from '../lib/markdown/note.js';
import { slugify } from '../lib/slug.js';
import { commitChange } from '../lib/vaultGit.js';
import type { NoteFrontmatter } from '../types.js';

export class NoteServiceError extends HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'NoteServiceError';
  }
}

export interface Note {
  slug: string;
  frontmatter: NoteFrontmatter;
  body: string;
}

export interface CreateNoteInput {
  title: string;
  tags?: string[];
  body?: string;
}

export interface UpdateNoteInput {
  title?: string;
  tags?: string[];
  body?: string;
  /**
   * Renames the note's filename/slug — a deliberate, explicit action
   * distinct from `title` (PLAN.md "Notes": the slug is otherwise assigned
   * once at creation and never follows a later title edit, so this is the
   * only way to fix a note stuck as `untitled-note-2.md` after the fact).
   * Sanitized through the same `slugify()` creation uses; conflicts with an
   * existing note reject with 409 rather than auto-suffixing — unlike
   * creation's auto-disambiguation, a rename is a specific, deliberate
   * target the caller chose, so silently picking a different one instead
   * would be surprising.
   */
  newSlug?: string;
}

function notesDir(workspacePath: string): string {
  return path.join(workspacePath, 'notes');
}

function noteFilePath(workspacePath: string, slug: string): string {
  return path.join(notesDir(workspacePath), `${slug}.md`);
}

function noteRelPath(slug: string): string {
  return path.join('notes', `${slug}.md`);
}

function listSlugs(workspacePath: string): string[] {
  const dir = notesDir(workspacePath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && fs.statSync(path.join(dir, f)).isFile())
    .map((f) => f.slice(0, -'.md'.length));
}

function toNote(slug: string, parsed: ParsedNoteFile): Note {
  return { slug, frontmatter: parsed.frontmatter, body: parsed.body };
}

function noteNotFoundError(workspacePath: string, slug: string): NoteServiceError {
  const suggestions = didYouMean(slug, listSlugs(workspacePath));
  const hint = suggestions.length > 0 ? ` — did you mean: ${suggestions.join(', ')}?` : '';
  return new NoteServiceError(`no note with slug "${slug}"${hint}`, 404);
}

/**
 * Turns a title into a unique filename slug, appending `-2`/`-3`/... on
 * collision — unlike a project (which rejects a duplicate name outright,
 * PLAN.md), a note's title is much more likely to be reused verbatim
 * ("Meeting notes", "Ideas") and forcing a rename before creation would be
 * needless friction for something this disposable to create. The slug is
 * filename-only, never shown as the note's identity in the UI (that's
 * `frontmatter.title`, editable independently), so it doesn't need to be
 * "nice" beyond being unique.
 */
function uniqueSlug(workspacePath: string, title: string): string {
  const base = slugify(title) || 'note';
  const existing = new Set(listSlugs(workspacePath));
  const taken = (s: string) => existing.has(s) || RESERVED_SLUGS.has(s);
  if (!taken(base)) return base;
  let n = 2;
  while (taken(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Slugs that must never be assigned to a real note — currently just `new`,
 * reserved by the client's `/notes/new` route (a draft that doesn't exist
 * on disk yet, per PLAN.md "Notes"). React Router ranks that literal
 * segment over the `/notes/:slug` dynamic one regardless of order, so a
 * note titled "New" would otherwise slugify to `new` and become permanently
 * unreachable by direct URL, shadowed by the draft page. `uniqueSlug`
 * treats it as always-taken so such a title falls through to `new-2`
 * instead, the same way an actual filename collision would.
 */
const RESERVED_SLUGS = new Set(['new']);

/** Reads and parses a note file directly from disk — never from the index,
 * per PLAN.md's "which reads go where" (single-item reads are never stale). */
export function loadNoteFile(workspacePath: string, slug: string): ParsedNoteFile {
  const filePath = noteFilePath(workspacePath, slug);
  if (!fs.existsSync(filePath)) throw noteNotFoundError(workspacePath, slug);
  return parseNoteFile(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Writes `parsed` to `targetSlug`'s file. When `targetSlug` differs from
 * `oldSlug` this is a rename: the new file is written first, then the old
 * one removed, and both relative paths are staged in the same commit (git
 * detects this as a rename in `diff`/`log --follow`, same as a plain
 * `git mv` would).
 */
function saveNoteFile(
  workspacePath: string,
  oldSlug: string,
  targetSlug: string,
  parsed: ParsedNoteFile,
  origin: string,
  message: string,
): void {
  const targetPath = noteFilePath(workspacePath, targetSlug);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, serializeNoteFile(parsed), 'utf8');
  const paths = [noteRelPath(targetSlug)];
  if (targetSlug !== oldSlug) {
    fs.rmSync(noteFilePath(workspacePath, oldSlug));
    paths.push(noteRelPath(oldSlug));
  }
  try {
    reconcileWorkspace(workspacePath);
  } catch (err) {
    console.error(`[notes] index reconcile failed for ${workspacePath}:`, (err as Error).message);
  }
  commitChange(workspacePath, { origin, message, paths });
}

export function getNote(workspacePath: string, slug: string): Note {
  return toNote(slug, loadNoteFile(workspacePath, slug));
}

export function createNote(workspacePath: string, input: CreateNoteInput, origin = 'api'): Note {
  const title = input.title?.trim();
  if (!title) throw new NoteServiceError('title is required', 400);

  const slug = uniqueSlug(workspacePath, title);
  const now = new Date().toISOString();
  const frontmatter: NoteFrontmatter = { title, created: now, updated: now, tags: input.tags ?? [] };
  const parsed: ParsedNoteFile = { frontmatter, body: input.body ?? '' };

  saveNoteFile(workspacePath, slug, slug, parsed, origin, `create_note ${slug}`);
  return toNote(slug, parsed);
}

/** Fields left `undefined` keep their existing value, same full-replace-on-
 * provide convention as `updateProject`/`putJournalEntry`. `updated` is
 * always bumped to now, since reaching this function at all means the
 * caller asked to write something — the filename/slug never changes even
 * when `title` does (PLAN.md "Notes": the slug is assigned once at
 * creation). */
export function updateNote(workspacePath: string, slug: string, input: UpdateNoteInput, origin = 'api'): Note {
  const parsed = loadNoteFile(workspacePath, slug);
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new NoteServiceError('title cannot be empty', 400);
    parsed.frontmatter.title = title;
  }
  if (input.tags !== undefined) parsed.frontmatter.tags = input.tags;
  if (input.body !== undefined) parsed.body = input.body;
  parsed.frontmatter.updated = new Date().toISOString();

  let targetSlug = slug;
  if (input.newSlug !== undefined) {
    const sanitized = slugify(input.newSlug);
    if (!sanitized) throw new NoteServiceError('filename cannot be empty', 400);
    if (sanitized !== slug) {
      if (RESERVED_SLUGS.has(sanitized)) {
        throw new NoteServiceError(`"${sanitized}" is a reserved filename`, 409);
      }
      if (fs.existsSync(noteFilePath(workspacePath, sanitized))) {
        throw new NoteServiceError(`a note with filename "${sanitized}" already exists`, 409);
      }
      targetSlug = sanitized;
    }
  }

  const message = targetSlug !== slug ? `rename_note ${slug} -> ${targetSlug}` : `update_note ${slug}`;
  saveNoteFile(workspacePath, slug, targetSlug, parsed, origin, message);
  return toNote(targetSlug, parsed);
}

export function deleteNote(workspacePath: string, slug: string, origin = 'api'): void {
  const filePath = noteFilePath(workspacePath, slug);
  if (!fs.existsSync(filePath)) throw noteNotFoundError(workspacePath, slug);

  fs.rmSync(filePath);
  try {
    reconcileWorkspace(workspacePath);
  } catch (err) {
    console.error(`[notes] index reconcile failed for ${workspacePath}:`, (err as Error).message);
  }
  commitChange(workspacePath, { origin, message: `delete_note ${slug}`, paths: [noteRelPath(slug)] });
}

/** `GET /api/notes` — every note's metadata (no body), most-recently-updated
 * first — reads from the index (PLAN.md "which reads go where": aggregate
 * views read the index, and can lag until the next reconciliation). */
export function listNotes(workspacePath: string): IndexedNote[] {
  return queryAllNotes(workspacePath);
}

/** `GET /api/notes?q=` — case-insensitive substring match over title/tags
 * only (never body — the index never caches note body text). */
export function searchNotes(workspacePath: string, q: string): IndexedNote[] {
  return querySearchNotes(workspacePath, q);
}
