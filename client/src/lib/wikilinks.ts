// Wikilinks (milestone 32, PLAN.md "Links between journals, notes and
// tasks"): `[[target]]` / `[[target|label]]` inline in a journal body, note
// body or task description. `target` is a task id (`t_…`), a journal date
// (`YYYY-MM-DD`), or a note's slug or title.
//
// The syntax rules must stay in sync with server/src/lib/markdown/wikilinks.ts.

export type WikilinkKind = 'task' | 'journal' | 'note';

/** What a link target or a backlink source points at (mirrors the server's
 * `LinkRef`). `title` is the display text: a note's title, a task's text, a
 * journal's date. */
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
  /** The target exactly as written. */
  target: string;
  /** null when nothing by that name exists (a dangling link). */
  ref: LinkRef | null;
}

export const WIKILINK_RE = /\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]*))?\]\]/g;

function withoutCode(text: string): string {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:\n\1[^\n]*(?=\n|$)|$)/gm, '').replace(/`[^`\n]*`/g, '');
}

/** Distinct targets in document order, trimmed; code spans and fenced
 * blocks don't count. */
export function extractWikilinks(text: string): string[] {
  if (!text.includes('[[')) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of withoutCode(text).matchAll(WIKILINK_RE)) {
    const target = match[1].trim();
    if (!target || seen.has(target)) continue;
    seen.add(target);
    out.push(target);
  }
  return out;
}

/** The text between `[[` and `]]` for a picked target: `id|label`, or just
 * `id` when the label adds nothing (a journal date). */
export function wikilinkInner(ref: LinkRef): string {
  const label = ref.title.replace(/[\[\]|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return label && label.toLowerCase() !== ref.id.toLowerCase() ? `${ref.id}|${label}` : ref.id;
}

/** Where a link leads inside the app. */
export function wikilinkHref(ref: LinkRef): string {
  if (ref.kind === 'note') return `/notes/${encodeURIComponent(ref.id)}`;
  if (ref.kind === 'journal') return `/journal/${ref.id.slice(0, 4)}/${ref.id}`;
  return `/projects/${encodeURIComponent(ref.projectSlug ?? '')}`;
}
