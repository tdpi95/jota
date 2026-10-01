// Links between journals, notes and tasks (milestone 32, PLAN.md "Links
// between journals, notes and tasks"). The links themselves are inline
// `[[wikilinks]]` in markdown text; this service only resolves a target to
// the thing it names and finds a thing's backlinks. Both read the index
// (aggregate views — PLAN.md "which reads go where"), which is reconciled
// on every write, so they never need to parse a file themselves.

import { HttpError } from '../lib/httpError.js';
import { queryAllNotes, queryTaskById, queryWikilinkSources, type IndexedNote } from '../lib/index/queries.js';
import { classifyWikilinkTarget, type WikilinkKind } from '../lib/markdown/wikilinks.js';

export class LinkServiceError extends HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'LinkServiceError';
  }
}

/** What a link target or a backlink source points at. `title` is the
 * display text (a note's title, a task's text, a journal's date). Task-only
 * fields are set only when `kind` is 'task'. */
export interface LinkRef {
  kind: WikilinkKind;
  /** Note slug, task id, or journal date. */
  id: string;
  title: string;
  status?: 'todo' | 'doing' | 'done';
  projectSlug?: string;
  projectName?: string;
  projectColor?: string;
}

export interface ResolvedLink {
  /** The target exactly as written in the `[[...]]`. */
  target: string;
  /** null when nothing by that name exists (a dangling link). */
  ref: LinkRef | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function taskRef(workspacePath: string, taskId: string): LinkRef | null {
  const task = queryTaskById(workspacePath, taskId);
  if (!task) return null;
  return {
    kind: 'task',
    id: task.id,
    title: task.text,
    status: task.status,
    projectSlug: task.projectSlug,
    projectName: task.projectName,
    projectColor: task.projectColor,
  };
}

/** A note is addressed by slug (stable — the filename), falling back to its
 * title, case-insensitively, the way Obsidian resolves a bare `[[Title]]`. */
function findNote(notes: IndexedNote[], target: string): IndexedNote | undefined {
  const lower = target.toLowerCase();
  return notes.find((n) => n.slug.toLowerCase() === lower) ?? notes.find((n) => n.title.toLowerCase() === lower);
}

/** Journal dates always resolve (any day is openable), so a `[[2026-09-30]]`
 * is never dangling. */
export function resolveLinks(workspacePath: string, targets: string[]): ResolvedLink[] {
  const notes = queryAllNotes(workspacePath);
  return [...new Set(targets.map((t) => t.trim()).filter(Boolean))].map((target) => {
    const kind = classifyWikilinkTarget(target);
    if (kind === 'task') return { target, ref: taskRef(workspacePath, target) };
    if (kind === 'journal') return { target, ref: { kind, id: target, title: target } };
    const note = findNote(notes, target);
    return { target, ref: note ? { kind: 'note', id: note.slug, title: note.title } : null };
  });
}

/** `GET /api/links/backlinks?kind=&id=` — everything whose text links to the
 * given journal day, note or task. Excludes the thing itself (a note linking
 * to itself isn't a backlink worth showing). */
export function getBacklinks(workspacePath: string, kind: string, id: string): LinkRef[] {
  if (kind !== 'task' && kind !== 'journal' && kind !== 'note') throw new LinkServiceError(`invalid kind "${kind}"`, 400);
  if (!id) throw new LinkServiceError('id is required', 400);
  if (kind === 'journal' && !DATE_RE.test(id)) throw new LinkServiceError(`invalid date "${id}", expected YYYY-MM-DD`, 400);

  const notes = queryAllNotes(workspacePath);
  let candidates: string[] = [id];
  if (kind === 'note') {
    const note = notes.find((n) => n.slug === id);
    candidates = note ? [note.slug, note.title] : [id];
  }

  const refs: LinkRef[] = [];
  for (const source of queryWikilinkSources(workspacePath, candidates)) {
    if (source.kind === kind && source.id === id) continue;
    if (source.kind === 'task') {
      const ref = taskRef(workspacePath, source.id);
      if (ref) refs.push(ref);
    } else if (source.kind === 'journal') {
      refs.push({ kind: 'journal', id: source.id, title: source.id });
    } else {
      const note = notes.find((n) => n.slug === source.id);
      if (note) refs.push({ kind: 'note', id: note.slug, title: note.title });
    }
  }
  return refs;
}
