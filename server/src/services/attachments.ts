// File attachment storage (milestone 27, PLAN.md "File attachments"). Plain
// binary files living under `<workspace>/attachments/<folder>/`, one
// subfolder per content type — real content (not `.poco/`), so it's
// committed to git and travels with the workspace like everything else.
//
// Deliberately no SQLite index table: attachments carry no queryable
// metadata of their own (PLAN.md's index is a derived cache over parsed
// markdown/frontmatter; a binary file has neither), so file-system-only is
// the right fit here — see the milestone's design notes.

import fs from 'node:fs';
import path from 'node:path';

import { HttpError } from '../lib/httpError.js';
import { commitChange } from '../lib/vaultGit.js';

export class AttachmentServiceError extends HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'AttachmentServiceError';
  }
}

/** One subfolder per content type that can carry attachments. A project's
 * profile image lives under `projects/` too, alongside task/journal/note
 * attachments — same storage mechanism, just referenced from a frontmatter
 * field instead of embedded as a markdown link (see services/projects.ts). */
export const ATTACHMENT_FOLDERS = ['tasks', 'journal', 'notes', 'projects'] as const;
export type AttachmentFolder = (typeof ATTACHMENT_FOLDERS)[number];

export function isAttachmentFolder(value: string): value is AttachmentFolder {
  return (ATTACHMENT_FOLDERS as readonly string[]).includes(value);
}

export interface AttachmentInfo {
  folder: AttachmentFolder;
  filename: string;
  /** Workspace-relative path, forward-slashed, e.g. "attachments/notes/foo.png"
   * — this is what a project's `profileImage` frontmatter field stores. */
  path: string;
  /** API URL to fetch/display the file, e.g. "/api/attachments/notes/foo.png". */
  url: string;
}

export function attachmentsDirPath(workspacePath: string, folder: AttachmentFolder): string {
  return path.join(workspacePath, 'attachments', folder);
}

function attachmentRelPath(folder: AttachmentFolder, filename: string): string {
  return `attachments/${folder}/${filename}`;
}

/** Strips any directory components and characters that would be awkward or
 * unsafe in a URL path segment / markdown link target. Deliberately
 * permissive otherwise (keeps spaces, unicode, etc.) — unlike a note/project
 * slug, an attachment's filename is meant to stay recognizable, not be
 * regenerated from title text. */
function sanitizeFilename(original: string): string {
  const base = path.basename(original).trim();
  const cleaned = base.replace(/[/\\?%*:|"<>\x00-\x1f]/g, '_');
  return cleaned || 'file';
}

/** Auto-suffixes on a colliding filename (foo.png, foo-2.png, foo-3.png, ...)
 * — same precedent as a note's colliding-title auto-suffix (PLAN.md "Note
 * file"), rather than overwriting or rejecting. */
function uniqueFilename(dir: string, filename: string): string {
  if (!fs.existsSync(path.join(dir, filename))) return filename;
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  let n = 2;
  let candidate = `${base}-${n}${ext}`;
  while (fs.existsSync(path.join(dir, candidate))) {
    n += 1;
    candidate = `${base}-${n}${ext}`;
  }
  return candidate;
}

/** Writes an uploaded file into the workspace's attachments folder and
 * commits it (its own commit, independent of whatever task/note/journal/
 * project write later embeds a reference to it — the two are decoupled, same
 * as any other independent write in this app). No size limit (a deliberate
 * choice, not an oversight — see the milestone's design notes on the
 * git-repo-bloat trade-off this implies for very large files). */
export function saveAttachment(
  workspacePath: string,
  folder: AttachmentFolder,
  originalName: string,
  data: Buffer,
  origin = 'api',
): AttachmentInfo {
  const dir = attachmentsDirPath(workspacePath, folder);
  fs.mkdirSync(dir, { recursive: true });

  const filename = uniqueFilename(dir, sanitizeFilename(originalName));
  fs.writeFileSync(path.join(dir, filename), data);

  const relPath = attachmentRelPath(folder, filename);
  commitChange(workspacePath, { origin, message: `attach_file ${relPath}`, paths: [relPath] });

  return { folder, filename, path: relPath, url: `/api/attachments/${folder}/${filename}` };
}

export function attachmentNotFoundError(folder: AttachmentFolder, filename: string): AttachmentServiceError {
  return new AttachmentServiceError(`no attachment "${filename}" in "${folder}"`, 404);
}
