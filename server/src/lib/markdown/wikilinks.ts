// Wikilinks (milestone 32, PLAN.md "Links between journals, notes and
// tasks"): `[[target]]` or `[[target|label]]` written inline in a journal
// body, a note body or a task description. The markdown text is the only
// source of truth; the index's `wikilinks` table is a derived cache of what
// each file points at.
//
// Must stay in sync with client/src/lib/wikilinks.ts.

export type WikilinkKind = 'task' | 'journal' | 'note';

/** `[[target]]` / `[[target|label]]` — no nesting, no line breaks. */
export const WIKILINK_RE = /\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]*))?\]\]/g;

const TASK_ID_RE = /^t_[0-9A-Za-z]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A bare task id is a task, a bare date a journal entry, anything else a
 * note (by slug, falling back to a case-insensitive title match). */
export function classifyWikilinkTarget(target: string): WikilinkKind {
  if (TASK_ID_RE.test(target)) return 'task';
  if (DATE_RE.test(target)) return 'journal';
  return 'note';
}

/** Fenced blocks and inline code spans are literal text, not links (this is
 * also what keeps encrypted `jota-enc:` tokens out of it). */
function withoutCode(text: string): string {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:\n\1[^\n]*(?=\n|$)|$)/gm, '').replace(/`[^`\n]*`/g, '');
}

/** Distinct targets in document order, trimmed. */
export function extractWikilinks(text: string | null | undefined): string[] {
  if (!text || !text.includes('[[')) return [];
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
