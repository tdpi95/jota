// File attachment reference parsing/formatting (milestone 27, PLAN.md "File
// attachments"). Attachments embedded in a task description, journal body,
// or note body are plain markdown image/link syntax pointing at a real,
// file-relative path under `<workspace>/attachments/<folder>/` — no new
// grammar or frontmatter field, so the reference round-trips untouched
// through every existing read/write path (task/note/journal body text is
// already opaque to the server) and stays a genuine relative link that
// resolves in any external tool pointed at the same workspace, not just this
// app (unlike a plain `/api/attachments/...` URL baked into the text, which
// would only work here). A project's profile image is the one exception —
// it's a structured frontmatter field, not a body-embedded link, so it
// stores a workspace-relative path directly (see services/projects.ts).

import type { MouseEvent } from 'react';

import { getPocoBridge } from './pocoBridge';

/** The three content types that embed attachments as markdown links inside
 * their own freeform body/description text. Project profile images use the
 * same `attachments/projects/` folder but aren't part of this — see above. */
export type AttachmentBodyFolder = 'tasks' | 'journal' | 'notes';

/** Relative-path prefix from a file of this content type up to the
 * workspace root's `attachments/` folder:
 * - a task's description lives inside `projects/<slug>.md` (1 level deep)
 * - a note lives at `notes/<slug>.md` (1 level deep)
 * - a journal entry lives at `journal/<year>/<date>.md` (2 levels deep)
 */
const RELATIVE_PREFIX: Record<AttachmentBodyFolder, string> = {
  tasks: '../attachments/tasks/',
  notes: '../attachments/notes/',
  journal: '../../attachments/journal/',
};

/** The markdown snippet to insert for a just-uploaded file — an image embed
 * for an image file, a plain link otherwise. The destination is wrapped in
 * `<...>` (CommonMark's angle-bracket link-destination form) rather than
 * written bare: a bare destination can't contain a literal space or
 * unbalanced parens, both of which appear in perfectly ordinary real-world
 * filenames ("Project Timeline.xlsx", "invoice (final).pdf") — markdown-it
 * (and any other CommonMark-compliant renderer) correctly refuses to parse
 * such a bare destination as a link at all, rendering the literal
 * `[text](broken url)` text instead (a real bug this was, not a hypothetical
 * one). The angle-bracket form allows any character except a literal
 * `<`/`>`/newline, none of which a filename can ever contain
 * (`sanitizeFilename`, server-side, already strips them). */
export function attachmentMarkdown(folder: AttachmentBodyFolder, filename: string, isImage: boolean): string {
  const dest = `<${RELATIVE_PREFIX[folder]}${filename}>`;
  return isImage ? `![${filename}](${dest})` : `[${filename}](${dest})`;
}

export function appendAttachment(body: string, markdownRef: string): string {
  return body.trim() ? `${body}\n\n${markdownRef}` : markdownRef;
}

export interface ParsedAttachmentRef {
  filename: string;
  isImage: boolean;
  /** API URL to fetch/display the file. */
  url: string;
}

/** Matches an attachment reference in either form this app has ever written:
 * the current `[alt](<../attachments/<folder>/<file>>)` (angle-bracket
 * destination, allows a space/parens in `<file>`) or the pre-fix bare
 * `[alt](../attachments/<folder>/<file>)` (still recognized so an
 * already-saved reference from before this fix keeps showing up in
 * `AttachmentField`'s list — only a *space-containing* filename written in
 * the bare form was ever actually broken, and re-parsing it wouldn't un-break
 * the already-saved markdown anyway). Two alternatives rather than one
 * pattern with an optional `<`/`>`, since only the bracketed form's filename
 * group can safely allow a space. */
const ATTACHMENT_REF_RE =
  /(!)?\[([^\]]*)\]\(<(?:\.\.\/)+attachments\/([a-z]+)\/([^>]+)>\)|(!)?\[([^\]]*)\]\((?:\.\.\/)+attachments\/([a-z]+)\/([^)\s]+)\)/g;

/** Scans body/description text for attachment references belonging to
 * `folder`, de-duplicated by filename, in document order — backs
 * `AttachmentField`'s inline thumbnail/chip list (there's no separate
 * stored list; the markdown text is the only source of truth). */
export function parseAttachmentRefs(body: string, folder: AttachmentBodyFolder): ParsedAttachmentRef[] {
  const results: ParsedAttachmentRef[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(ATTACHMENT_REF_RE)) {
    const bang = match[1] ?? match[5];
    const altText = match[2] ?? match[6];
    const matchedFolder = match[3] ?? match[7];
    const filename = match[4] ?? match[8];
    if (matchedFolder !== folder || seen.has(filename)) continue;
    seen.add(filename);
    // The URL needs its filename percent-encoded regardless of which form
    // matched — a raw space (or other reserved character) in an href/src
    // attribute is unreliable, unlike in the markdown source text itself.
    results.push({ filename: altText || filename, isImage: bang === '!', url: `/api/attachments/${folder}/${encodeURIComponent(filename)}` });
  }
  return results;
}

/** Extracts "attachments/<folder>/<file>" (the workspace-relative form
 * `window.poco.openAttachment` expects) from an `/api/attachments/...` URL —
 * the shape every attachment `<a href>`/`<img src>` in this app resolves to,
 * whether from `AttachmentField`'s own chip list or a rendered markdown link/
 * image (`renderMarkdown.ts`). */
function workspaceRelativePath(url: string): string | null {
  const match = url.match(/^\/api\/(attachments\/[^/]+\/[^/]+)$/);
  return match ? match[1] : null;
}

/**
 * Click handler for an attachment link/image (milestone 27 follow-up: "open
 * image, file by system apps"). Inside Electron, hands off to the native
 * `shell.openPath` bridge and prevents the anchor's own default action —
 * relying on a plain `target="_blank"` click's default browser behavior
 * turned out to be unreliable there: for a file Electron's `BrowserWindow`
 * can't render inline (e.g. a PDF, since it has no PDF viewer plugin
 * enabled), Chromium silently downloads it instead of opening a new window,
 * which never reaches `setWindowOpenHandler`'s main-process fallback at all
 * — intercepting the click here, before the browser gets to make that
 * navigate-or-download decision, sidesteps it entirely. Outside Electron (no
 * bridge, e.g. a plain browser tab), this does nothing and the anchor's
 * normal `target="_blank"` click proceeds exactly as before.
 */
export function openAttachmentIfPossible(event: { preventDefault(): void }, url: string): void {
  const bridge = getPocoBridge();
  if (!bridge) return;
  const relPath = workspaceRelativePath(url);
  if (!relPath) return;
  event.preventDefault();
  void bridge.openAttachment(relPath);
}

/**
 * Same as `openAttachmentIfPossible`, but for a container of *rendered*
 * markdown HTML (`dangerouslySetInnerHTML` — Notes' Preview mode, the task
 * view modal's description) rather than a React-owned `<a>` this app wrote
 * itself: there's no per-element `onClick` to attach inside raw HTML, so
 * this is meant as one delegated handler on the container, finding whichever
 * `<a>` (if any) the click actually landed on or inside (e.g. a click on an
 * embedded attachment image, which `renderMarkdown.ts` wraps in a link).
 */
export function handleRenderedAttachmentClick(event: MouseEvent<HTMLElement>): void {
  const anchor = (event.target as HTMLElement).closest('a');
  if (!anchor) return;
  openAttachmentIfPossible(event, anchor.getAttribute('href') ?? '');
}
